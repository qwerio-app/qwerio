use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use chrono::{DateTime as ChronoDateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::stream::TryStreamExt;
use mongodb::bson::{doc as mongo_doc, Document as MongoDocument};
use mongodb::options::ClientOptions as MongoClientOptions;
use mongodb::Client as MongoClient;
use mysql_async::prelude::Queryable;
use mysql_async::{OptsBuilder, Pool, Row as MySqlRow, Value as MySqlValue};
use redis::Client as RedisClient;
use rustls::client::danger::{
    HandshakeSignatureValid as RustlsHandshakeSignatureValid,
    ServerCertVerified as RustlsServerCertVerified,
    ServerCertVerifier as RustlsServerCertVerifier,
};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{
    ClientConfig as RustlsClientConfig, DigitallySignedStruct, RootCertStore,
    SignatureScheme,
};
use rusqlite::types::{Value as SqliteValue, ValueRef as SqliteValueRef};
use rusqlite::{params_from_iter, Connection as SqliteConnection};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use tiberius::{
    AuthMethod, Client as SqlServerRawClient, Config as SqlServerConfig, EncryptionLevel,
    Row as SqlServerRow, ToSql as SqlServerToSql,
};
use tokio::net::TcpStream;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{Mutex, RwLock};
use tokio_postgres::tls::{
    ChannelBinding as PostgresChannelBinding, MakeTlsConnect, TlsConnect,
    TlsStream as PostgresTlsStream,
};
use tokio_postgres::types::ToSql;
use tokio_postgres::{Client as PgClient, NoTls};
use tokio_rustls::client::TlsStream as RustlsTlsStream;
use tokio_rustls::TlsConnector;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use uuid::Uuid;
use webpki_roots::TLS_SERVER_ROOTS;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
type SqlServerClient = SqlServerRawClient<tokio_util::compat::Compat<TcpStream>>;

#[derive(Clone)]
struct MakePostgresRustlsConnect {
    connector: TlsConnector,
}

#[derive(Debug)]
struct InsecureServerCertVerifier {
    supported_algs: rustls::crypto::WebPkiSupportedAlgorithms,
}

impl InsecureServerCertVerifier {
    fn new() -> Self {
        Self {
            supported_algs: rustls::crypto::aws_lc_rs::default_provider()
                .signature_verification_algorithms,
        }
    }
}

impl RustlsServerCertVerifier for InsecureServerCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<RustlsServerCertVerified, rustls::Error> {
        Ok(RustlsServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<RustlsHandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.supported_algs)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<RustlsHandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.supported_algs)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.supported_algs.supported_schemes()
    }
}

static RUSTLS_PROVIDER_INIT: OnceLock<Result<(), String>> = OnceLock::new();

fn ensure_rustls_crypto_provider() -> Result<(), String> {
    RUSTLS_PROVIDER_INIT
        .get_or_init(|| {
            rustls::crypto::aws_lc_rs::default_provider()
                .install_default()
                .map_err(|_| "Failed to install rustls aws-lc-rs crypto provider.".to_string())
        })
        .clone()
}

impl MakePostgresRustlsConnect {
    fn new(allow_invalid_certs: bool) -> Result<Self, String> {
        ensure_rustls_crypto_provider()?;
        let config = if allow_invalid_certs {
            RustlsClientConfig::builder()
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(
                    InsecureServerCertVerifier::new(),
                ))
                .with_no_client_auth()
        } else {
            let mut roots = RootCertStore::empty();
            roots.extend(TLS_SERVER_ROOTS.iter().cloned());

            RustlsClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth()
        };

        Ok(Self {
            connector: TlsConnector::from(Arc::new(config)),
        })
    }
}

struct PostgresRustlsConnect {
    connector: TlsConnector,
    server_name: ServerName<'static>,
}

struct PostgresRustlsStream<S>(RustlsTlsStream<S>);

impl<S> MakeTlsConnect<S> for MakePostgresRustlsConnect
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    type Stream = PostgresRustlsStream<S>;
    type TlsConnect = PostgresRustlsConnect;
    type Error = std::io::Error;

    fn make_tls_connect(&mut self, domain: &str) -> Result<Self::TlsConnect, Self::Error> {
        let server_name = ServerName::try_from(domain.to_string()).map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("invalid TLS server name '{domain}': {error}"),
            )
        })?;

        Ok(PostgresRustlsConnect {
            connector: self.connector.clone(),
            server_name,
        })
    }
}

impl<S> TlsConnect<S> for PostgresRustlsConnect
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    type Stream = PostgresRustlsStream<S>;
    type Error = std::io::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Stream, Self::Error>> + Send>>;

    fn connect(self, stream: S) -> Self::Future {
        Box::pin(async move {
            let tls_stream = self.connector.connect(self.server_name, stream).await?;
            Ok(PostgresRustlsStream(tls_stream))
        })
    }
}

impl<S> AsyncRead for PostgresRustlsStream<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_read(cx, buf)
    }
}

impl<S> AsyncWrite for PostgresRustlsStream<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.0).poll_write(cx, buf)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[std::io::IoSlice<'_>],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.0).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.0.is_write_vectored()
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_shutdown(cx)
    }
}

impl<S> PostgresTlsStream for PostgresRustlsStream<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn channel_binding(&self) -> PostgresChannelBinding {
        PostgresChannelBinding::none()
    }
}

#[derive(Default)]
struct AppState {
    connections: RwLock<HashMap<String, DbConnection>>,
}

#[derive(Clone)]
enum DbConnection {
    Postgres(Arc<PgClient>),
    MySql(Pool),
    SqlServer(Arc<Mutex<SqlServerClient>>),
    Sqlite(Arc<String>),
    Redis(Arc<RedisClient>),
    Mongo(Arc<MongoClient>),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConnectionConfig {
    id: String,
    dialect: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    port: u16,
    database: String,
    #[serde(default)]
    user: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    preferred_tls_mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbConnectResult {
    resolved_tls_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequest {
    connection_id: String,
    sql: String,
    params: Option<Vec<JsonValue>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryColumn {
    name: String,
    db_type: String,
    nullable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryResult {
    columns: Vec<QueryColumn>,
    rows: Vec<JsonValue>,
    row_count: usize,
    elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
struct Schema {
    name: String,
}

#[derive(Debug, Serialize)]
struct DbObjectName {
    name: String,
}

#[derive(Debug, Serialize)]
struct SchemaObjectMap {
    tables: Vec<DbObjectName>,
    views: Vec<DbObjectName>,
    functions: Vec<DbObjectName>,
    triggers: Vec<DbObjectName>,
    indexes: Vec<DbObjectName>,
    procedures: Vec<DbObjectName>,
    sequences: Vec<DbObjectName>,
}

impl SchemaObjectMap {
    fn empty() -> Self {
        Self {
            tables: Vec::new(),
            views: Vec::new(),
            functions: Vec::new(),
            triggers: Vec::new(),
            indexes: Vec::new(),
            procedures: Vec::new(),
            sequences: Vec::new(),
        }
    }

    fn push(&mut self, object_type: &str, name: String) {
        if name.trim().is_empty() {
            return;
        }

        let object = DbObjectName { name };

        match object_type {
            "tables" => self.tables.push(object),
            "views" => self.views.push(object),
            "functions" => self.functions.push(object),
            "triggers" => self.triggers.push(object),
            "indexes" => self.indexes.push(object),
            "procedures" => self.procedures.push(object),
            "sequences" => self.sequences.push(object),
            _ => {}
        }
    }
}

#[tauri::command]
async fn db_connect(
    connection: DesktopConnectionConfig,
    state: tauri::State<'_, AppState>,
) -> Result<DbConnectResult, String> {
    validate_connection_input(&connection)?;
    let password = connection.password.as_deref();
    let mut resolved_tls_mode: Option<String> = None;

    let db_connection = match connection.dialect.as_str() {
        "postgres" => {
            let (client, mode) = connect_postgres(&connection, password).await?;
            resolved_tls_mode = Some(mode.storage_value().to_string());
            DbConnection::Postgres(Arc::new(client))
        }
        "mysql" => DbConnection::MySql(connect_mysql(&connection, password).await?),
        "sqlserver" => DbConnection::SqlServer(Arc::new(Mutex::new(
            connect_sql_server(&connection, password).await?,
        ))),
        "sqlite" => DbConnection::Sqlite(Arc::new(connect_sqlite(&connection)?)),
        "redis" => DbConnection::Redis(Arc::new(connect_redis(&connection, password).await?)),
        "mongodb" => DbConnection::Mongo(Arc::new(connect_mongodb(&connection, password).await?)),
        _ => return Err(format!("Unsupported dialect: {}", connection.dialect)),
    };

    let mut guard = state.connections.write().await;
    guard.insert(connection.id, db_connection);

    Ok(DbConnectResult { resolved_tls_mode })
}

#[tauri::command]
async fn db_execute(
    req: QueryRequest,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResult, String> {
    if req.connection_id.is_empty() {
        return Err("connectionId is required".into());
    }

    if req.sql.trim().is_empty() {
        return Err("sql is required".into());
    }

    let connection = {
        let guard = state.connections.read().await;
        guard
            .get(&req.connection_id)
            .cloned()
            .ok_or_else(|| "Connection is not established. Reconnect and retry.".to_string())?
    };

    match connection {
        DbConnection::Postgres(client) => {
            execute_postgres(client.as_ref(), &req.sql, req.params.as_deref()).await
        }
        DbConnection::MySql(pool) => execute_mysql(&pool, &req.sql, req.params.as_deref()).await,
        DbConnection::SqlServer(client) => {
            execute_sql_server(client.as_ref(), &req.sql, req.params.as_deref()).await
        }
        DbConnection::Sqlite(database_path) => {
            execute_sqlite(database_path.as_ref().as_str(), &req.sql, req.params.as_deref())
        }
        DbConnection::Redis(client) => {
            execute_redis(client.as_ref(), &req.sql, req.params.as_deref()).await
        }
        DbConnection::Mongo(client) => {
            execute_mongodb(client.as_ref(), &req.sql, req.params.as_deref()).await
        }
    }
}

#[tauri::command]
fn db_cancel(_request_id: &str) -> Result<(), String> {
    Err("Query cancellation is not implemented yet for native drivers.".into())
}

#[tauri::command]
async fn db_list_schemas(
    connection_id: &str,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Schema>, String> {
    let connection = {
        let guard = state.connections.read().await;
        guard
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Connection is not established. Reconnect and retry.".to_string())?
    };

    match connection {
        DbConnection::Postgres(client) => {
            let rows = client
                .query(
                    "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
                    &[],
                )
                .await
                .map_err(|error| format!("Postgres schema listing failed: {error}"))?;

            Ok(rows
                .into_iter()
                .filter_map(|row| row.try_get::<usize, String>(0).ok())
                .map(|name| Schema { name })
                .collect())
        }
        DbConnection::MySql(pool) => {
            let mut conn = pool
                .get_conn()
                .await
                .map_err(|error| format!("MySQL connection failed: {error}"))?;

            let rows: Vec<(String,)> = conn
                .query("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name")
                .await
                .map_err(|error| format!("MySQL schema listing failed: {error}"))?;

            Ok(rows.into_iter().map(|(name,)| Schema { name }).collect())
        }
        DbConnection::SqlServer(client) => sql_server_list_schemas(client.as_ref()).await,
        DbConnection::Sqlite(database_path) => list_sqlite_schemas(database_path.as_ref().as_str()),
        DbConnection::Redis(client) => list_redis_schemas(client.as_ref()).await,
        DbConnection::Mongo(client) => list_mongodb_schemas(client.as_ref()).await,
    }
}

#[tauri::command]
async fn db_list_tables(
    connection_id: &str,
    schema: &str,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DbObjectName>, String> {
    let connection = {
        let guard = state.connections.read().await;
        guard
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Connection is not established. Reconnect and retry.".to_string())?
    };

    match connection {
        DbConnection::Postgres(client) => {
            let statement = client
                .prepare(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
                )
                .await
                .map_err(|error| format!("Postgres table listing prepare failed: {error}"))?;

            let rows = client
                .query(&statement, &[&schema])
                .await
                .map_err(|error| format!("Postgres table listing failed: {error}"))?;

            Ok(rows
                .into_iter()
                .filter_map(|row| row.try_get::<usize, String>(0).ok())
                .map(|name| DbObjectName { name })
                .collect())
        }
        DbConnection::MySql(pool) => {
            let mut conn = pool
                .get_conn()
                .await
                .map_err(|error| format!("MySQL connection failed: {error}"))?;

            let rows: Vec<(String,)> = conn
                .exec(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
                    (schema,),
                )
                .await
                .map_err(|error| format!("MySQL table listing failed: {error}"))?;

            Ok(rows
                .into_iter()
                .map(|(name,)| DbObjectName { name })
                .collect())
        }
        DbConnection::SqlServer(client) => sql_server_list_tables(client.as_ref(), schema).await,
        DbConnection::Sqlite(database_path) => {
            list_sqlite_tables(database_path.as_ref().as_str(), schema)
        }
        DbConnection::Redis(client) => list_redis_tables(client.as_ref(), schema).await,
        DbConnection::Mongo(client) => list_mongodb_tables(client.as_ref(), schema).await,
    }
}

#[tauri::command]
async fn db_list_schema_objects(
    connection_id: &str,
    schema: &str,
    state: tauri::State<'_, AppState>,
) -> Result<SchemaObjectMap, String> {
    let connection = {
        let guard = state.connections.read().await;
        guard
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Connection is not established. Reconnect and retry.".to_string())?
    };

    match connection {
        DbConnection::Postgres(client) => {
            let statement = client
                .prepare(
                    "SELECT object_type, name FROM (
                        SELECT 'tables'::text AS object_type, table_name::text AS name
                        FROM information_schema.tables
                        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
                        UNION ALL
                        SELECT 'views'::text AS object_type, table_name::text AS name
                        FROM information_schema.views
                        WHERE table_schema = $1
                        UNION ALL
                        SELECT DISTINCT 'functions'::text AS object_type, routine_name::text AS name
                        FROM information_schema.routines
                        WHERE specific_schema = $1 AND routine_type = 'FUNCTION'
                        UNION ALL
                        SELECT DISTINCT 'procedures'::text AS object_type, routine_name::text AS name
                        FROM information_schema.routines
                        WHERE specific_schema = $1 AND routine_type = 'PROCEDURE'
                        UNION ALL
                        SELECT DISTINCT 'triggers'::text AS object_type, trigger_name::text AS name
                        FROM information_schema.triggers
                        WHERE trigger_schema = $1
                        UNION ALL
                        SELECT 'indexes'::text AS object_type, indexname::text AS name
                        FROM pg_indexes
                        WHERE schemaname = $1
                        UNION ALL
                        SELECT 'sequences'::text AS object_type, sequence_name::text AS name
                        FROM information_schema.sequences
                        WHERE sequence_schema = $1
                    ) objects
                    WHERE name IS NOT NULL
                    ORDER BY object_type, name",
                )
                .await
                .map_err(|error| format!("Postgres schema object listing prepare failed: {error}"))?;

            let rows = client
                .query(&statement, &[&schema])
                .await
                .map_err(|error| format!("Postgres schema object listing failed: {error}"))?;

            let mut result = SchemaObjectMap::empty();

            for row in rows {
                let object_type = row.try_get::<usize, String>(0).unwrap_or_default();
                let name = row.try_get::<usize, String>(1).unwrap_or_default();
                result.push(&object_type, name);
            }

            Ok(result)
        }
        DbConnection::MySql(pool) => {
            let mut conn = pool
                .get_conn()
                .await
                .map_err(|error| format!("MySQL connection failed: {error}"))?;

            let rows: Vec<(String, String)> = conn
                .exec(
                    "SELECT object_type, name FROM (
                        SELECT 'tables' AS object_type, table_name AS name
                        FROM information_schema.tables
                        WHERE table_schema = ? AND table_type = 'BASE TABLE'
                        UNION ALL
                        SELECT 'views' AS object_type, table_name AS name
                        FROM information_schema.views
                        WHERE table_schema = ?
                        UNION ALL
                        SELECT DISTINCT 'functions' AS object_type, routine_name AS name
                        FROM information_schema.routines
                        WHERE routine_schema = ? AND routine_type = 'FUNCTION'
                        UNION ALL
                        SELECT DISTINCT 'procedures' AS object_type, routine_name AS name
                        FROM information_schema.routines
                        WHERE routine_schema = ? AND routine_type = 'PROCEDURE'
                        UNION ALL
                        SELECT DISTINCT 'triggers' AS object_type, trigger_name AS name
                        FROM information_schema.triggers
                        WHERE trigger_schema = ?
                        UNION ALL
                        SELECT 'indexes' AS object_type, CONCAT(table_name, '.', index_name) AS name
                        FROM information_schema.statistics
                        WHERE table_schema = ? AND index_name <> 'PRIMARY'
                        GROUP BY table_name, index_name
                    ) objects
                    ORDER BY object_type, name",
                    (schema, schema, schema, schema, schema, schema),
                )
                .await
                .map_err(|error| format!("MySQL schema object listing failed: {error}"))?;

            let mut result = SchemaObjectMap::empty();

            for (object_type, name) in rows {
                result.push(&object_type, name);
            }

            Ok(result)
        }
        DbConnection::SqlServer(client) => {
            sql_server_list_schema_objects(client.as_ref(), schema).await
        }
        DbConnection::Sqlite(database_path) => {
            list_sqlite_schema_objects(database_path.as_ref().as_str(), schema)
        }
        DbConnection::Redis(client) => list_redis_schema_objects(client.as_ref(), schema).await,
        DbConnection::Mongo(client) => list_mongodb_schema_objects(client.as_ref(), schema).await,
    }
}

async fn connect_postgres(
    config: &DesktopConnectionConfig,
    password: Option<&str>,
) -> Result<(PgClient, PostgresConnectMode), String> {
    let mut pg_config = tokio_postgres::Config::new();

    if is_localhost_host(&config.host) {
        // Prefer IPv4 first for common local dev setups.
        pg_config.host("127.0.0.1");
        pg_config.host("::1");
    } else {
        pg_config.host(&config.host);
    }

    pg_config.port(config.port);
    pg_config.dbname(&config.database);
    pg_config.user(&config.user);

    if let Some(password) = password {
        if !password.is_empty() {
            pg_config.password(password);
        }
    }

    let preferred_mode = config
        .preferred_tls_mode
        .as_deref()
        .and_then(PostgresConnectMode::from_storage_value);

    match connect_postgres_config(
        pg_config,
        true,
        !is_localhost_host(&config.host),
        preferred_mode,
    )
    .await
    {
        Ok((client, mode)) => return Ok((client, mode)),
        Err(tcp_error) => {
            #[cfg(unix)]
            if is_localhost_host(&config.host) {
                let socket_dirs = ["/var/run/postgresql", "/tmp"];
                let mut socket_errors: Vec<String> = Vec::new();

                for socket_dir in socket_dirs {
                    let socket_path = format!("{socket_dir}/.s.PGSQL.{}", config.port);

                    if !Path::new(&socket_path).exists() {
                        continue;
                    }

                    let mut socket_cfg = tokio_postgres::Config::new();
                    socket_cfg.host_path(socket_dir);
                    socket_cfg.port(config.port);
                    socket_cfg.dbname(&config.database);
                    socket_cfg.user(&config.user);

                    if let Some(password) = password {
                        if !password.is_empty() {
                            socket_cfg.password(password);
                        }
                    }

                    match connect_postgres_config(socket_cfg, false, false, None).await {
                        Ok((client, mode)) => return Ok((client, mode)),
                        Err(socket_error) => {
                            socket_errors.push(format!("{socket_dir}: {socket_error}"))
                        }
                    }
                }

                if !socket_errors.is_empty() {
                    return Err(format!(
                        "Postgres connection failed over TCP ({tcp_error}) and Unix socket fallback ({})",
                        socket_errors.join("; ")
                    ));
                }
            }

            Err(format!("Postgres connection failed: {tcp_error}"))
        }
    }
}

async fn connect_mysql(
    config: &DesktopConnectionConfig,
    password: Option<&str>,
) -> Result<Pool, String> {
    let mut opts = OptsBuilder::default()
        .ip_or_hostname(config.host.clone())
        .tcp_port(config.port)
        .db_name(Some(config.database.clone()))
        .user(Some(config.user.clone()));

    if let Some(password) = password {
        if !password.is_empty() {
            opts = opts.pass(Some(password.to_string()));
        }
    }

    match verify_mysql_pool(Pool::new(opts)).await {
        Ok(pool) => return Ok(pool),
        Err(tcp_error) => {
            #[cfg(unix)]
            if is_localhost_host(&config.host) {
                let socket_paths = [
                    "/var/run/mysqld/mysqld.sock",
                    "/run/mysqld/mysqld.sock",
                    "/tmp/mysql.sock",
                ];
                let mut socket_errors: Vec<String> = Vec::new();

                for socket in socket_paths {
                    if !Path::new(socket).exists() {
                        continue;
                    }

                    let mut socket_opts = OptsBuilder::default()
                        .ip_or_hostname("localhost")
                        .tcp_port(config.port)
                        .db_name(Some(config.database.clone()))
                        .user(Some(config.user.clone()))
                        .socket(Some(socket))
                        .prefer_socket(Some(true));

                    if let Some(password) = password {
                        if !password.is_empty() {
                            socket_opts = socket_opts.pass(Some(password.to_string()));
                        }
                    }

                    match verify_mysql_pool(Pool::new(socket_opts)).await {
                        Ok(pool) => return Ok(pool),
                        Err(error) => socket_errors.push(format!("{socket}: {error}")),
                    }
                }

                if !socket_errors.is_empty() {
                    return Err(format!(
                        "MySQL connection failed over TCP ({tcp_error}) and Unix socket fallback ({})",
                        socket_errors.join("; ")
                    ));
                }
            }

            Err(format!("MySQL connection failed: {tcp_error}"))
        }
    }
}

async fn connect_sql_server(
    config: &DesktopConnectionConfig,
    password: Option<&str>,
) -> Result<SqlServerClient, String> {
    let normalized_host = normalize_sql_server_host_input(&config.host)?;
    let host_candidates = sql_server_host_candidates(&normalized_host);
    let encryption_candidates = [
        EncryptionLevel::Required,
        EncryptionLevel::On,
        EncryptionLevel::Off,
        EncryptionLevel::NotSupported,
    ];
    let mut errors: Vec<String> = Vec::new();

    for host in host_candidates {
        for encryption in encryption_candidates {
            match connect_sql_server_attempt(config, password, host, encryption).await {
                Ok(client) => return Ok(client),
                Err(error) => {
                    errors.push(format!(
                        "{host} ({}) -> {error}",
                        sql_server_encryption_label(encryption)
                    ));
                }
            }
        }
    }

    let attempts = errors.len();
    let details = errors
        .iter()
        .take(4)
        .cloned()
        .collect::<Vec<String>>()
        .join("; ");

    Err(format!(
        "SQL Server connection failed after {attempts} attempts. {details}. Checks: verify SQL Server TCP/IP is enabled, use host and explicit TCP port (not host\\\\instance), confirm SQL authentication is enabled, and confirm firewall access to port {}.",
        config.port
    ))
}

async fn connect_sql_server_attempt(
    config: &DesktopConnectionConfig,
    password: Option<&str>,
    host: &str,
    encryption: EncryptionLevel,
) -> Result<SqlServerClient, String> {
    let mut sql_server_config = SqlServerConfig::new();
    sql_server_config.host(host);
    sql_server_config.port(config.port);
    sql_server_config.database(&config.database);
    sql_server_config.authentication(AuthMethod::sql_server(
        config.user.clone(),
        password.unwrap_or_default().to_string(),
    ));
    sql_server_config.encryption(encryption);
    if encryption != EncryptionLevel::NotSupported {
        sql_server_config.trust_cert();
    }

    let tcp = tokio::time::timeout(
        CONNECT_TIMEOUT,
        TcpStream::connect(sql_server_config.get_addr()),
    )
    .await
    .map_err(|_| format!("TCP connect timed out after {}s", CONNECT_TIMEOUT.as_secs()))?
    .map_err(|error| format!("TCP connect failed: {error}"))?;
    tcp.set_nodelay(true)
        .map_err(|error| format!("Failed to set TCP nodelay: {error}"))?;

    tokio::time::timeout(
        CONNECT_TIMEOUT,
        SqlServerRawClient::connect(sql_server_config, tcp.compat_write()),
    )
    .await
    .map_err(|_| {
        format!(
            "Login/handshake timed out after {}s",
            CONNECT_TIMEOUT.as_secs()
        )
    })?
    .map_err(|error| format!("Login/handshake failed: {error}"))
}

fn connect_sqlite(config: &DesktopConnectionConfig) -> Result<String, String> {
    let database_path = config.database.trim();
    let connection = open_sqlite_connection(database_path)?;
    connection
        .query_row("SELECT 1", [], |_row| Ok(()))
        .map_err(|error| format!("SQLite connection test query failed: {error}"))?;
    Ok(database_path.to_string())
}

async fn connect_redis(
    config: &DesktopConnectionConfig,
    password: Option<&str>,
) -> Result<RedisClient, String> {
    let host = config.host.trim();
    let database = config.database.trim();
    let db_index = database
        .parse::<u32>()
        .map_err(|_| "Redis database must be a non-negative integer.".to_string())?;
    let username = config.user.trim();
    let password = password.unwrap_or_default();
    let auth_segment = if !username.is_empty() {
        format!("{username}:{password}@")
    } else if !password.is_empty() {
        format!(":{password}@")
    } else {
        String::new()
    };
    let url = format!("redis://{auth_segment}{host}:{}/{db_index}", config.port);
    let client = RedisClient::open(url.as_str())
        .map_err(|error| format!("Redis client initialization failed: {error}"))?;

    let mut connection = tokio::time::timeout(
        CONNECT_TIMEOUT,
        client.get_multiplexed_async_connection(),
    )
    .await
    .map_err(|_| {
        format!(
            "Redis connect timed out after {}s. Verify host reachability and credentials.",
            CONNECT_TIMEOUT.as_secs()
        )
    })?
    .map_err(|error| format!("Redis connect failed: {error}"))?;

    let pong: String = tokio::time::timeout(
        CONNECT_TIMEOUT,
        redis::cmd("PING").query_async(&mut connection),
    )
    .await
    .map_err(|_| {
        format!(
            "Redis PING timed out after {}s. Verify server responsiveness.",
            CONNECT_TIMEOUT.as_secs()
        )
    })?
    .map_err(|error| format!("Redis PING failed: {error}"))?;

    if !pong.eq_ignore_ascii_case("PONG") {
        return Err("Redis health check did not return PONG.".to_string());
    }

    Ok(client)
}

async fn connect_mongodb(
    config: &DesktopConnectionConfig,
    password: Option<&str>,
) -> Result<MongoClient, String> {
    let host = config.host.trim();
    let username = config.user.trim();
    let password = password.unwrap_or_default();
    let auth_segment = if !username.is_empty() {
        format!("{username}:{password}@")
    } else {
        String::new()
    };
    let uri = format!("mongodb://{auth_segment}{host}:{}", config.port);

    let mut options = tokio::time::timeout(CONNECT_TIMEOUT, MongoClientOptions::parse(&uri))
        .await
        .map_err(|_| {
            format!(
                "MongoDB connect timed out after {}s. Verify host reachability and credentials.",
                CONNECT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|error| format!("MongoDB options parse failed: {error}"))?;
    options.app_name = Some("qwerio".to_string());

    let client = MongoClient::with_options(options)
        .map_err(|error| format!("MongoDB client initialization failed: {error}"))?;
    let database = if config.database.trim().is_empty() {
        "admin"
    } else {
        config.database.trim()
    };

    tokio::time::timeout(
        CONNECT_TIMEOUT,
        client.database(database).run_command(mongo_doc! {"ping": 1}),
    )
    .await
    .map_err(|_| {
        format!(
            "MongoDB ping timed out after {}s. Verify server responsiveness.",
            CONNECT_TIMEOUT.as_secs()
        )
    })?
    .map_err(|error| format!("MongoDB ping failed: {error}"))?;

    Ok(client)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PostgresConnectMode {
    TlsVerified,
    TlsInsecure,
    Plaintext,
}

impl PostgresConnectMode {
    fn label(self) -> &'static str {
        match self {
            PostgresConnectMode::TlsVerified => "TLS (verified cert)",
            PostgresConnectMode::TlsInsecure => "TLS (allow invalid cert)",
            PostgresConnectMode::Plaintext => "non-TLS",
        }
    }

    fn storage_value(self) -> &'static str {
        match self {
            PostgresConnectMode::TlsVerified => "tls-verified-cert",
            PostgresConnectMode::TlsInsecure => "tls-allow-invalid-cert",
            PostgresConnectMode::Plaintext => "non-tls",
        }
    }

    fn from_storage_value(value: &str) -> Option<Self> {
        match value {
            "tls-verified-cert" => Some(PostgresConnectMode::TlsVerified),
            "tls-allow-invalid-cert" => Some(PostgresConnectMode::TlsInsecure),
            "non-tls" => Some(PostgresConnectMode::Plaintext),
            _ => None,
        }
    }
}

fn looks_like_postgres_tls_error(message: &str) -> bool {
    let lower = message.to_lowercase();

    lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("certificate")
        || lower.contains("handshake")
        || lower.contains("requires encryption")
        || lower.contains("encrypted connection")
        || lower.contains("no encryption")
}

fn format_postgres_connect_error(error: tokio_postgres::Error) -> String {
    if let Some(db_error) = error.as_db_error() {
        let mut details = vec![format!(
            "{} (SQLSTATE {})",
            db_error.message(),
            db_error.code().code()
        )];

        if let Some(detail) = db_error.detail() {
            if !detail.trim().is_empty() {
                details.push(format!("detail: {detail}"));
            }
        }

        if let Some(hint) = db_error.hint() {
            if !hint.trim().is_empty() {
                details.push(format!("hint: {hint}"));
            }
        }

        return details.join(". ");
    }

    let raw = error.to_string();
    if raw.trim().is_empty() {
        "Unknown Postgres connection error.".to_string()
    } else {
        raw
    }
}

async fn connect_postgres_with_mode(
    config: &tokio_postgres::Config,
    mode: PostgresConnectMode,
) -> Result<PgClient, String> {
    match mode {
        PostgresConnectMode::TlsVerified => {
            let tls_connector = MakePostgresRustlsConnect::new(false)?;
            let (client, connection) =
                tokio::time::timeout(CONNECT_TIMEOUT, config.connect(tls_connector))
                    .await
                    .map_err(|_| {
                        format!(
                            "Postgres {} connect timed out after {}s. Verify host reachability, certificates, and credentials.",
                            mode.label(),
                            CONNECT_TIMEOUT.as_secs()
                        )
                    })?
                    .map_err(format_postgres_connect_error)?;

            tokio::spawn(async move {
                if let Err(error) = connection.await {
                    eprintln!("postgres connection task ended with error: {error}");
                }
            });

            Ok(client)
        }
        PostgresConnectMode::TlsInsecure => {
            let tls_connector = MakePostgresRustlsConnect::new(true)?;
            let (client, connection) =
                tokio::time::timeout(CONNECT_TIMEOUT, config.connect(tls_connector))
                    .await
                    .map_err(|_| {
                        format!(
                            "Postgres {} connect timed out after {}s. Verify host reachability and credentials.",
                            mode.label(),
                            CONNECT_TIMEOUT.as_secs()
                        )
                    })?
                    .map_err(format_postgres_connect_error)?;

            eprintln!(
                "warning: postgres connection established using insecure TLS certificate acceptance"
            );

            tokio::spawn(async move {
                if let Err(error) = connection.await {
                    eprintln!("postgres connection task ended with error: {error}");
                }
            });

            Ok(client)
        }
        PostgresConnectMode::Plaintext => {
            let (client, connection) =
                tokio::time::timeout(CONNECT_TIMEOUT, config.connect(NoTls))
                    .await
                    .map_err(|_| {
                        format!(
                            "Postgres {} connect timed out after {}s. Verify host reachability and credentials.",
                            mode.label(),
                            CONNECT_TIMEOUT.as_secs()
                        )
                    })?
                    .map_err(format_postgres_connect_error)?;

            tokio::spawn(async move {
                if let Err(error) = connection.await {
                    eprintln!("postgres connection task ended with error: {error}");
                }
            });

            Ok(client)
        }
    }
}

async fn connect_postgres_config(
    config: tokio_postgres::Config,
    allow_tls: bool,
    prefer_tls: bool,
    preferred_mode: Option<PostgresConnectMode>,
) -> Result<(PgClient, PostgresConnectMode), String> {
    let mut modes = if allow_tls {
        if prefer_tls {
            vec![
                PostgresConnectMode::TlsVerified,
                PostgresConnectMode::TlsInsecure,
                PostgresConnectMode::Plaintext,
            ]
        } else {
            vec![
                PostgresConnectMode::Plaintext,
                PostgresConnectMode::TlsVerified,
                PostgresConnectMode::TlsInsecure,
            ]
        }
    } else {
        vec![PostgresConnectMode::Plaintext]
    };

    if let Some(preferred_mode) = preferred_mode {
        if let Some(index) = modes.iter().position(|mode| *mode == preferred_mode) {
            modes.remove(index);
            modes.insert(0, preferred_mode);
        }
    }

    let mut errors: Vec<String> = Vec::new();

    for mode in modes {
        match connect_postgres_with_mode(&config, mode).await {
            Ok(client) => return Ok((client, mode)),
            Err(error) => errors.push(format!("{}: {error}", mode.label())),
        }
    }

    let attempts = errors.len();
    let message = format!(
        "Postgres connection failed after {attempts} attempt{}: {}",
        if attempts == 1 { "" } else { "s" },
        errors.join("; ")
    );

    if looks_like_postgres_tls_error(&message) {
        return Err(format!(
            "{message}. Checks: verified TLS is attempted first, then insecure TLS cert acceptance. Ensure pg_hba/server SSL policy allows this connection mode and credentials."
        ));
    }

    Err(message)
}

async fn verify_mysql_pool(pool: Pool) -> Result<Pool, String> {
    let mut conn = tokio::time::timeout(CONNECT_TIMEOUT, pool.get_conn())
        .await
        .map_err(|_| {
            format!(
                "MySQL connect timed out after {}s. Verify host reachability and credentials.",
                CONNECT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(CONNECT_TIMEOUT, conn.ping())
        .await
        .map_err(|_| {
            format!(
                "MySQL ping timed out after {}s. Verify server responsiveness.",
                CONNECT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|error| error.to_string())?;
    drop(conn);
    Ok(pool)
}

async fn execute_postgres(
    client: &PgClient,
    sql: &str,
    params: Option<&[JsonValue]>,
) -> Result<QueryResult, String> {
    let started = Instant::now();
    let statement = client
        .prepare(sql)
        .await
        .map_err(|error| format!("Postgres prepare failed: {error}"))?;

    let bind_params = build_postgres_params(params);
    let bind_refs: Vec<&(dyn ToSql + Sync)> = bind_params
        .iter()
        .map(|value| value.as_ref() as &(dyn ToSql + Sync))
        .collect();

    if looks_like_resultset_query(sql) || sql.to_lowercase().contains(" returning ") {
        let rows = client
            .query(&statement, &bind_refs)
            .await
            .map_err(|error| format!("Postgres query failed: {error}"))?;

        let columns = statement
            .columns()
            .iter()
            .map(|column| QueryColumn {
                name: column.name().to_string(),
                db_type: column.type_().name().to_string(),
                nullable: true,
            })
            .collect::<Vec<QueryColumn>>();

        let rows = rows
            .into_iter()
            .map(postgres_row_to_json)
            .collect::<Vec<JsonValue>>();

        return Ok(QueryResult {
            columns,
            row_count: rows.len(),
            rows,
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    let affected_rows = client
        .execute(&statement, &bind_refs)
        .await
        .map_err(|error| format!("Postgres command execution failed: {error}"))?;

    Ok(QueryResult {
        columns: vec![QueryColumn {
            name: "status".to_string(),
            db_type: "text".to_string(),
            nullable: false,
        }],
        rows: vec![serde_json::json!({
            "status": format!("OK ({affected_rows} rows affected)")
        })],
        row_count: 1,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

async fn execute_mysql(
    pool: &Pool,
    sql: &str,
    params: Option<&[JsonValue]>,
) -> Result<QueryResult, String> {
    let started = Instant::now();
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|error| format!("MySQL connection failed: {error}"))?;

    let mysql_params = params
        .unwrap_or(&[])
        .iter()
        .map(json_to_mysql_param)
        .collect::<Vec<MySqlValue>>();

    if !looks_like_resultset_query(sql) {
        if mysql_params.is_empty() {
            conn.query_drop(sql)
                .await
                .map_err(|error| format!("MySQL query failed: {error}"))?;
        } else {
            conn.exec_drop(sql, mysql_params)
                .await
                .map_err(|error| format!("MySQL query failed: {error}"))?;
        }

        return Ok(QueryResult {
            columns: vec![QueryColumn {
                name: "status".to_string(),
                db_type: "text".to_string(),
                nullable: false,
            }],
            rows: vec![serde_json::json!({
                "status": format!("OK ({} rows affected)", conn.affected_rows())
            })],
            row_count: 1,
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    if mysql_params.is_empty() {
        let mut result = conn
            .query_iter(sql)
            .await
            .map_err(|error| format!("MySQL query failed: {error}"))?;

        let columns: Vec<QueryColumn> = result
            .columns_ref()
            .iter()
            .map(|column| QueryColumn {
                name: column.name_str().to_string(),
                db_type: format!("{:?}", column.column_type()),
                nullable: true,
            })
            .collect();

        let rows: Vec<MySqlRow> = result
            .collect()
            .await
            .map_err(|error| format!("MySQL row collection failed: {error}"))?;

        let rows = rows
            .into_iter()
            .map(mysql_row_to_json)
            .collect::<Vec<JsonValue>>();

        return Ok(QueryResult {
            columns,
            row_count: rows.len(),
            rows,
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    let mut result = conn
        .exec_iter(sql, mysql_params)
        .await
        .map_err(|error| format!("MySQL query failed: {error}"))?;

    let columns: Vec<QueryColumn> = result
        .columns_ref()
        .iter()
        .map(|column| QueryColumn {
            name: column.name_str().to_string(),
            db_type: format!("{:?}", column.column_type()),
            nullable: true,
        })
        .collect();

    let rows: Vec<MySqlRow> = result
        .collect()
        .await
        .map_err(|error| format!("MySQL row collection failed: {error}"))?;

    let rows = rows
        .into_iter()
        .map(mysql_row_to_json)
        .collect::<Vec<JsonValue>>();

    Ok(QueryResult {
        columns,
        row_count: rows.len(),
        rows,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

async fn execute_sql_server(
    client: &Mutex<SqlServerClient>,
    sql: &str,
    params: Option<&[JsonValue]>,
) -> Result<QueryResult, String> {
    ensure_sql_server_params_supported(params)?;
    let started = Instant::now();
    let mut guard = client.lock().await;

    if !looks_like_resultset_query(sql) {
        let bind_params: [&dyn SqlServerToSql; 0] = [];
        let affected_rows = guard
            .execute(sql, &bind_params)
            .await
            .map_err(|error| format!("SQL Server command execution failed: {error}"))?
            .total();

        return Ok(QueryResult {
            columns: vec![QueryColumn {
                name: "status".to_string(),
                db_type: "text".to_string(),
                nullable: false,
            }],
            rows: vec![serde_json::json!({
                "status": format!("OK ({affected_rows} rows affected)")
            })],
            row_count: 1,
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    let rows = guard
        .simple_query(sql)
        .await
        .map_err(|error| format!("SQL Server query failed: {error}"))?
        .into_first_result()
        .await
        .map_err(|error| format!("SQL Server row collection failed: {error}"))?;

    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| QueryColumn {
                    name: column.name().to_string(),
                    db_type: format!("{:?}", column.column_type()),
                    nullable: true,
                })
                .collect::<Vec<QueryColumn>>()
        })
        .unwrap_or_default();
    let row_count = rows.len();
    let rows = rows
        .into_iter()
        .map(sql_server_row_to_json)
        .collect::<Vec<JsonValue>>();

    Ok(QueryResult {
        columns,
        rows,
        row_count,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

fn execute_sqlite(
    database_path: &str,
    sql: &str,
    params: Option<&[JsonValue]>,
) -> Result<QueryResult, String> {
    let started = Instant::now();
    let connection = open_sqlite_connection(database_path)?;
    let sqlite_params = build_sqlite_params(params);
    let normalized_sql = sql.trim_start().to_lowercase();
    let should_return_rows =
        looks_like_resultset_query(sql) || normalized_sql.contains(" returning ");

    if should_return_rows {
        let mut statement = connection
            .prepare(sql)
            .map_err(|error| format!("SQLite prepare failed: {error}"))?;
        let column_count = statement.column_count();
        let column_names = (0..column_count)
            .map(|index| {
                statement
                    .column_name(index)
                    .map(|name| name.to_string())
                    .unwrap_or_else(|_| format!("column_{}", index + 1))
            })
            .collect::<Vec<String>>();
        let columns = column_names
            .iter()
            .map(|name| QueryColumn {
                name: name.clone(),
                db_type: "sqlite".to_string(),
                nullable: true,
            })
            .collect::<Vec<QueryColumn>>();
        let mut rows = statement
            .query(params_from_iter(sqlite_params.iter()))
            .map_err(|error| format!("SQLite query failed: {error}"))?;
        let mut json_rows: Vec<JsonValue> = Vec::new();

        while let Some(row) = rows
            .next()
            .map_err(|error| format!("SQLite row collection failed: {error}"))?
        {
            let mut object = JsonMap::new();

            for (index, column_name) in column_names.iter().enumerate() {
                let value = row
                    .get_ref(index)
                    .map(sqlite_value_ref_to_json)
                    .unwrap_or(JsonValue::Null);
                object.insert(column_name.clone(), value);
            }

            json_rows.push(JsonValue::Object(object));
        }

        return Ok(QueryResult {
            columns,
            row_count: json_rows.len(),
            rows: json_rows,
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    let affected_rows = connection
        .execute(sql, params_from_iter(sqlite_params.iter()))
        .map_err(|error| format!("SQLite command execution failed: {error}"))?;

    Ok(QueryResult {
        columns: vec![QueryColumn {
            name: "status".to_string(),
            db_type: "text".to_string(),
            nullable: false,
        }],
        rows: vec![serde_json::json!({
            "status": format!("OK ({affected_rows} rows affected)")
        })],
        row_count: 1,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

async fn execute_redis(
    client: &RedisClient,
    sql: &str,
    params: Option<&[JsonValue]>,
) -> Result<QueryResult, String> {
    let started = Instant::now();
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Redis connection failed: {error}"))?;
    let command = sql.trim();

    if command.starts_with('{') {
        if let Ok(payload) = serde_json::from_str::<JsonValue>(command) {
            if let Some(result) = execute_redis_preview_payload(
                &mut connection,
                &payload,
                redis_default_database_index(client),
            )
            .await?
            {
                return Ok(json_value_to_query_result(result, started));
            }
        }
    }

    let mut tokens = parse_redis_command_tokens(command);
    if tokens.is_empty() {
        return Err("Redis command is required.".to_string());
    }

    if let Some(extra_params) = params {
        for value in extra_params {
            tokens.push(json_value_to_plain_string(value));
        }
    }

    let command_name = tokens.remove(0);
    let mut redis_command = redis::cmd(&command_name);
    for token in tokens {
        redis_command.arg(token);
    }

    let value: redis::Value = redis_command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Redis command failed: {error}"))?;

    Ok(json_value_to_query_result(redis_value_to_json(value), started))
}

async fn execute_mongodb(
    client: &MongoClient,
    sql: &str,
    _params: Option<&[JsonValue]>,
) -> Result<QueryResult, String> {
    let started = Instant::now();
    let payload: JsonValue = serde_json::from_str(sql.trim()).map_err(|_| {
        "MongoDB command must be valid JSON. Use {\"op\":\"find\",...} or {\"op\":\"command\",...}."
            .to_string()
    })?;
    let op = payload
        .get("op")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    if op == "find" {
        let database_name = payload
            .get("database")
            .and_then(|value| value.as_str())
            .unwrap_or("admin");
        let collection_name = payload
            .get("collection")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "MongoDB find requires 'collection'.".to_string())?;
        let limit = payload
            .get("limit")
            .and_then(|value| value.as_i64())
            .map(|value| value.clamp(1, 5_000))
            .unwrap_or(200);
        let filter = payload
            .get("filter")
            .and_then(json_value_to_mongo_document)
            .unwrap_or_default();

        let collection = client
            .database(database_name)
            .collection::<MongoDocument>(collection_name);
        let mut cursor = collection
            .find(filter)
            .limit(limit)
            .await
            .map_err(|error| format!("MongoDB find failed: {error}"))?;
        let mut rows: Vec<JsonValue> = Vec::new();

        while let Some(document) = cursor
            .try_next()
            .await
            .map_err(|error| format!("MongoDB cursor failed: {error}"))?
        {
            rows.push(mongo_document_to_json_value(document)?);
        }

        return Ok(json_value_to_query_result(JsonValue::Array(rows), started));
    }

    if op == "command" {
        let database_name = payload
            .get("database")
            .and_then(|value| value.as_str())
            .unwrap_or("admin");
        let command_payload = payload
            .get("command")
            .and_then(json_value_to_mongo_document)
            .ok_or_else(|| "MongoDB command requires a 'command' document.".to_string())?;
        let result = client
            .database(database_name)
            .run_command(command_payload)
            .await
            .map_err(|error| format!("MongoDB command failed: {error}"))?;

        return Ok(json_value_to_query_result(
            mongo_document_to_json_value(result)?,
            started,
        ));
    }

    Err("MongoDB command must define op='find' or op='command'.".to_string())
}

async fn list_redis_schemas(client: &RedisClient) -> Result<Vec<Schema>, String> {
    let default_db_index = redis_default_database_index(client);
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Redis connection failed: {error}"))?;
    let values_result: Result<Vec<String>, redis::RedisError> = redis::cmd("CONFIG")
        .arg("GET")
        .arg("databases")
        .query_async(&mut connection)
        .await;

    let mut database_indexes: Vec<u32> = values_result
        .ok()
        .and_then(|values| {
            values
                .get(1)
                .and_then(|value| value.parse::<usize>().ok())
                .map(|value| value.clamp(1, 1024))
        })
        .map(|total_databases| (0..total_databases).map(|index| index as u32).collect())
        .unwrap_or_else(|| vec![default_db_index]);

    if !database_indexes.contains(&default_db_index) {
        database_indexes.push(default_db_index);
    }

    database_indexes.sort_unstable();
    database_indexes.dedup();

    Ok(database_indexes
        .into_iter()
        .map(|index| Schema {
            name: format!("db{index}"),
        })
        .collect())
}

async fn list_redis_tables(
    client: &RedisClient,
    schema: &str,
) -> Result<Vec<DbObjectName>, String> {
    let objects = list_redis_schema_objects(client, schema).await?;
    Ok(objects.tables)
}

async fn list_redis_schema_objects(
    client: &RedisClient,
    schema: &str,
) -> Result<SchemaObjectMap, String> {
    let db_index = parse_redis_database_name(schema)?;
    let default_db_index = redis_default_database_index(client);
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Redis connection failed: {error}"))?;
    if db_index != default_db_index {
        let _: String = redis::cmd("SELECT")
            .arg(db_index)
            .query_async(&mut connection)
            .await
            .map_err(|error| format!("Redis database select failed: {error}"))?;
    }
    let keys = redis_scan_keys(&mut connection, 800).await?;
    let mut objects = SchemaObjectMap::empty();

    for key in keys {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(&mut connection)
            .await
            .map_err(|error| format!("Redis TYPE failed for key '{key}': {error}"))?;
        let object_type = match key_type.as_str() {
            "string" => "tables",
            "hash" => "views",
            "list" => "functions",
            "set" => "procedures",
            "zset" => "triggers",
            "stream" => "indexes",
            _ => "sequences",
        };
        objects.push(object_type, key);
    }

    Ok(objects)
}

async fn list_mongodb_schemas(client: &MongoClient) -> Result<Vec<Schema>, String> {
    let names = client
        .list_database_names()
        .await
        .map_err(|error| format!("MongoDB database listing failed: {error}"))?;

    Ok(names.into_iter().map(|name| Schema { name }).collect())
}

async fn list_mongodb_tables(
    client: &MongoClient,
    schema: &str,
) -> Result<Vec<DbObjectName>, String> {
    let names = client
        .database(schema)
        .list_collection_names()
        .await
        .map_err(|error| format!("MongoDB collection listing failed: {error}"))?;

    Ok(names
        .into_iter()
        .map(|name| DbObjectName { name })
        .collect())
}

async fn list_mongodb_schema_objects(
    client: &MongoClient,
    schema: &str,
) -> Result<SchemaObjectMap, String> {
    let tables = list_mongodb_tables(client, schema).await?;
    let mut objects = SchemaObjectMap::empty();

    for table in tables {
        objects.push("tables", table.name);
    }

    Ok(objects)
}

async fn sql_server_list_schemas(client: &Mutex<SqlServerClient>) -> Result<Vec<Schema>, String> {
    let rows = sql_server_query_rows(
        client,
        "SELECT name FROM sys.schemas ORDER BY name",
        "SQL Server schema listing failed",
    )
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| sql_server_row_string(&row, 0))
        .map(|name| Schema { name })
        .collect())
}

async fn sql_server_list_tables(
    client: &Mutex<SqlServerClient>,
    schema: &str,
) -> Result<Vec<DbObjectName>, String> {
    let escaped_schema = escape_sql_server_literal(schema);
    let sql = format!(
        "SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = N'{escaped_schema}' AND table_type = 'BASE TABLE'
         ORDER BY table_name"
    );
    let rows = sql_server_query_rows(client, &sql, "SQL Server table listing failed").await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| sql_server_row_string(&row, 0))
        .map(|name| DbObjectName { name })
        .collect())
}

async fn sql_server_list_schema_objects(
    client: &Mutex<SqlServerClient>,
    schema: &str,
) -> Result<SchemaObjectMap, String> {
    let escaped_schema = escape_sql_server_literal(schema);
    let sql = format!(
        "SELECT object_type, name FROM (
            SELECT 'tables' AS object_type, t.name AS name
            FROM sys.tables t
            INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
            WHERE s.name = N'{escaped_schema}'
            UNION ALL
            SELECT 'views' AS object_type, v.name AS name
            FROM sys.views v
            INNER JOIN sys.schemas s ON s.schema_id = v.schema_id
            WHERE s.name = N'{escaped_schema}'
            UNION ALL
            SELECT 'functions' AS object_type, o.name AS name
            FROM sys.objects o
            INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
            WHERE s.name = N'{escaped_schema}' AND o.type IN ('FN', 'IF', 'TF', 'FS', 'FT')
            UNION ALL
            SELECT 'procedures' AS object_type, p.name AS name
            FROM sys.procedures p
            INNER JOIN sys.schemas s ON s.schema_id = p.schema_id
            WHERE s.name = N'{escaped_schema}'
            UNION ALL
            SELECT 'triggers' AS object_type, tr.name AS name
            FROM sys.triggers tr
            INNER JOIN sys.tables t ON t.object_id = tr.parent_id
            INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
            WHERE s.name = N'{escaped_schema}'
            UNION ALL
            SELECT 'indexes' AS object_type, CONCAT(t.name, '.', i.name) AS name
            FROM sys.indexes i
            INNER JOIN sys.tables t ON t.object_id = i.object_id
            INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
            WHERE s.name = N'{escaped_schema}' AND i.name IS NOT NULL AND i.is_hypothetical = 0
            GROUP BY t.name, i.name
            UNION ALL
            SELECT 'sequences' AS object_type, seq.name AS name
            FROM sys.sequences seq
            INNER JOIN sys.schemas s ON s.schema_id = seq.schema_id
            WHERE s.name = N'{escaped_schema}'
         ) objects
         WHERE name IS NOT NULL
         ORDER BY object_type, name"
    );
    let rows =
        sql_server_query_rows(client, &sql, "SQL Server schema object listing failed").await?;
    let mut result = SchemaObjectMap::empty();

    for row in rows {
        let object_type = sql_server_row_string(&row, 0).unwrap_or_default();
        let name = sql_server_row_string(&row, 1).unwrap_or_default();
        result.push(&object_type, name);
    }

    Ok(result)
}

fn list_sqlite_schemas(database_path: &str) -> Result<Vec<Schema>, String> {
    let connection = open_sqlite_connection(database_path)?;
    let mut statement = connection
        .prepare("PRAGMA database_list")
        .map_err(|error| format!("SQLite schema listing prepare failed: {error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("SQLite schema listing failed: {error}"))?;
    let mut schemas: Vec<Schema> = Vec::new();

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("SQLite schema listing failed: {error}"))?
    {
        if let Ok(name) = row.get::<usize, String>(1) {
            schemas.push(Schema { name });
        }
    }

    Ok(schemas)
}

fn list_sqlite_tables(database_path: &str, schema: &str) -> Result<Vec<DbObjectName>, String> {
    let connection = open_sqlite_connection(database_path)?;
    let escaped_schema = escape_sqlite_identifier(schema);
    let sql = format!(
        "SELECT name FROM \"{escaped_schema}\".sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("SQLite table listing prepare failed: {error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("SQLite table listing failed: {error}"))?;
    let mut tables: Vec<DbObjectName> = Vec::new();

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("SQLite table listing failed: {error}"))?
    {
        if let Ok(name) = row.get::<usize, String>(0) {
            tables.push(DbObjectName { name });
        }
    }

    Ok(tables)
}

fn list_sqlite_schema_objects(
    database_path: &str,
    schema: &str,
) -> Result<SchemaObjectMap, String> {
    let connection = open_sqlite_connection(database_path)?;
    let escaped_schema = escape_sqlite_identifier(schema);
    let sql = format!(
        "SELECT object_type, name FROM (
            SELECT 'tables' AS object_type, name AS name
            FROM \"{escaped_schema}\".sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            UNION ALL
            SELECT 'views' AS object_type, name AS name
            FROM \"{escaped_schema}\".sqlite_master
            WHERE type = 'view'
            UNION ALL
            SELECT 'triggers' AS object_type, name AS name
            FROM \"{escaped_schema}\".sqlite_master
            WHERE type = 'trigger'
            UNION ALL
            SELECT 'indexes' AS object_type, name AS name
            FROM \"{escaped_schema}\".sqlite_master
            WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
        ) objects
        WHERE name IS NOT NULL
        ORDER BY object_type, name"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("SQLite schema object listing prepare failed: {error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("SQLite schema object listing failed: {error}"))?;
    let mut result = SchemaObjectMap::empty();

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("SQLite schema object listing failed: {error}"))?
    {
        let object_type = row.get::<usize, String>(0).unwrap_or_default();
        let name = row.get::<usize, String>(1).unwrap_or_default();
        result.push(&object_type, name);
    }

    Ok(result)
}

async fn sql_server_query_rows(
    client: &Mutex<SqlServerClient>,
    sql: &str,
    error_context: &str,
) -> Result<Vec<SqlServerRow>, String> {
    let mut guard = client.lock().await;
    let query_stream = guard
        .simple_query(sql)
        .await
        .map_err(|error| format!("{error_context}: {error}"))?;

    query_stream
        .into_first_result()
        .await
        .map_err(|error| format!("{error_context}: {error}"))
}

fn ensure_sql_server_params_supported(params: Option<&[JsonValue]>) -> Result<(), String> {
    if let Some(values) = params {
        if !values.is_empty() {
            return Err(
                "SQL Server parameter binding is not implemented yet. Use SQL text without params."
                    .to_string(),
            );
        }
    }

    Ok(())
}

fn sql_server_row_string(row: &SqlServerRow, index: usize) -> Option<String> {
    row.get::<&str, usize>(index).map(|value| value.to_string())
}

fn sql_server_row_to_json(row: SqlServerRow) -> JsonValue {
    let mut object = JsonMap::new();

    for (index, column) in row.columns().iter().enumerate() {
        object.insert(
            column.name().to_string(),
            sql_server_cell_to_json(&row, index),
        );
    }

    JsonValue::Object(object)
}

fn sql_server_cell_to_json(row: &SqlServerRow, index: usize) -> JsonValue {
    if let Some(value) = row.get::<bool, usize>(index) {
        return JsonValue::Bool(value);
    }

    if let Some(value) = row.get::<i16, usize>(index) {
        return JsonValue::Number((value as i64).into());
    }

    if let Some(value) = row.get::<i32, usize>(index) {
        return JsonValue::Number((value as i64).into());
    }

    if let Some(value) = row.get::<i64, usize>(index) {
        return JsonValue::Number(value.into());
    }

    if let Some(value) = row.get::<f32, usize>(index) {
        return JsonNumber::from_f64(value as f64)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null);
    }

    if let Some(value) = row.get::<f64, usize>(index) {
        return JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null);
    }

    if let Some(value) = row.get::<&str, usize>(index) {
        return JsonValue::String(value.to_string());
    }

    if let Some(value) = row.get::<&[u8], usize>(index) {
        return JsonValue::Array(value.iter().copied().map(JsonValue::from).collect());
    }

    JsonValue::Null
}

fn escape_sql_server_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn open_sqlite_connection(database_path: &str) -> Result<SqliteConnection, String> {
    let trimmed_path = database_path.trim();

    if trimmed_path.is_empty() {
        return Err("SQLite database path is required.".into());
    }

    SqliteConnection::open(trimmed_path)
        .map_err(|error| format!("SQLite connection failed for '{trimmed_path}': {error}"))
}

fn escape_sqlite_identifier(identifier: &str) -> String {
    let trimmed = identifier.trim();
    let schema_name = if trimmed.is_empty() { "main" } else { trimmed };
    schema_name.replace('"', "\"\"")
}

fn sqlite_value_ref_to_json(value: SqliteValueRef<'_>) -> JsonValue {
    match value {
        SqliteValueRef::Null => JsonValue::Null,
        SqliteValueRef::Integer(value) => JsonValue::Number(value.into()),
        SqliteValueRef::Real(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        SqliteValueRef::Text(value) => JsonValue::String(String::from_utf8_lossy(value).to_string()),
        SqliteValueRef::Blob(value) => {
            JsonValue::Array(value.iter().copied().map(JsonValue::from).collect())
        }
    }
}

fn build_sqlite_params(params: Option<&[JsonValue]>) -> Vec<SqliteValue> {
    params
        .unwrap_or(&[])
        .iter()
        .map(json_to_sqlite_param)
        .collect()
}

fn json_to_sqlite_param(value: &JsonValue) -> SqliteValue {
    match value {
        JsonValue::Null => SqliteValue::Null,
        JsonValue::Bool(value) => SqliteValue::Integer(if *value { 1 } else { 0 }),
        JsonValue::Number(number) => {
            if let Some(value) = number.as_i64() {
                SqliteValue::Integer(value)
            } else if let Some(value) = number.as_u64() {
                if let Ok(signed) = i64::try_from(value) {
                    SqliteValue::Integer(signed)
                } else {
                    SqliteValue::Text(number.to_string())
                }
            } else if let Some(value) = number.as_f64() {
                SqliteValue::Real(value)
            } else {
                SqliteValue::Text(number.to_string())
            }
        }
        JsonValue::String(value) => SqliteValue::Text(value.clone()),
        JsonValue::Array(_) | JsonValue::Object(_) => SqliteValue::Text(value.to_string()),
    }
}

fn mysql_row_to_json(row: MySqlRow) -> JsonValue {
    let columns = Arc::new(row.columns_ref().to_vec());
    let values = row.unwrap();
    let mut object = JsonMap::new();

    for (index, value) in values.into_iter().enumerate() {
        if let Some(column) = columns.get(index) {
            object.insert(column.name_str().to_string(), mysql_value_to_json(value));
        }
    }

    JsonValue::Object(object)
}

fn mysql_value_to_json(value: MySqlValue) -> JsonValue {
    match value {
        MySqlValue::NULL => JsonValue::Null,
        MySqlValue::Bytes(bytes) => match String::from_utf8(bytes.clone()) {
            Ok(text) => JsonValue::String(text),
            Err(_) => JsonValue::Array(
                bytes
                    .into_iter()
                    .map(|byte| JsonValue::from(byte))
                    .collect(),
            ),
        },
        MySqlValue::Int(value) => JsonValue::Number(value.into()),
        MySqlValue::UInt(value) => JsonValue::Number(value.into()),
        MySqlValue::Float(value) => JsonNumber::from_f64(value as f64)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        MySqlValue::Double(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        MySqlValue::Date(year, month, day, hour, minute, second, micros) => {
            JsonValue::String(format!(
                "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{:06}",
                micros
            ))
        }
        MySqlValue::Time(is_negative, days, hours, minutes, seconds, micros) => {
            JsonValue::String(format!(
                "{}{days}d {hours:02}:{minutes:02}:{seconds:02}.{:06}",
                if is_negative { "-" } else { "" },
                micros
            ))
        }
    }
}

fn build_postgres_params(params: Option<&[JsonValue]>) -> Vec<Box<dyn ToSql + Sync + Send>> {
    params
        .unwrap_or(&[])
        .iter()
        .map(json_to_postgres_param)
        .collect()
}

fn json_to_postgres_param(value: &JsonValue) -> Box<dyn ToSql + Sync + Send> {
    match value {
        JsonValue::Null => Box::new(Option::<String>::None),
        JsonValue::Bool(value) => Box::new(*value),
        JsonValue::Number(number) => {
            if let Some(value) = number.as_i64() {
                Box::new(value)
            } else if let Some(value) = number.as_u64() {
                if let Ok(signed) = i64::try_from(value) {
                    Box::new(signed)
                } else {
                    Box::new(value.to_string())
                }
            } else if let Some(value) = number.as_f64() {
                Box::new(value)
            } else {
                Box::new(number.to_string())
            }
        }
        JsonValue::String(value) => Box::new(value.clone()),
        JsonValue::Array(_) | JsonValue::Object(_) => Box::new(value.to_string()),
    }
}

fn postgres_row_to_json(row: tokio_postgres::Row) -> JsonValue {
    let mut object = JsonMap::new();

    for (index, column) in row.columns().iter().enumerate() {
        object.insert(
            column.name().to_string(),
            postgres_cell_to_json(&row, index),
        );
    }

    JsonValue::Object(object)
}

fn postgres_cell_to_json(row: &tokio_postgres::Row, index: usize) -> JsonValue {
    if let Ok(value) = row.try_get::<usize, Option<bool>>(index) {
        return value.map(JsonValue::Bool).unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<i16>>(index) {
        return value
            .map(|number| JsonValue::Number((number as i64).into()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<i32>>(index) {
        return value
            .map(|number| JsonValue::Number((number as i64).into()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<i64>>(index) {
        return value
            .map(|number| JsonValue::Number(number.into()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<f32>>(index) {
        return value
            .and_then(|number| JsonNumber::from_f64(number as f64).map(JsonValue::Number))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<f64>>(index) {
        return value
            .and_then(|number| JsonNumber::from_f64(number).map(JsonValue::Number))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<Uuid>>(index) {
        return value
            .map(|uuid| JsonValue::String(uuid.to_string()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<NaiveDate>>(index) {
        return value
            .map(|date| JsonValue::String(date.to_string()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<NaiveTime>>(index) {
        return value
            .map(|time| JsonValue::String(time.format("%H:%M:%S%.f").to_string()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<NaiveDateTime>>(index) {
        return value
            .map(|datetime| JsonValue::String(datetime.format("%Y-%m-%d %H:%M:%S%.f").to_string()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<ChronoDateTime<Utc>>>(index) {
        return value
            .map(|datetime| JsonValue::String(datetime.to_rfc3339()))
            .unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<String>>(index) {
        return value.map(JsonValue::String).unwrap_or(JsonValue::Null);
    }

    if let Ok(value) = row.try_get::<usize, Option<Vec<u8>>>(index) {
        return value
            .map(|bytes| JsonValue::Array(bytes.into_iter().map(JsonValue::from).collect()))
            .unwrap_or(JsonValue::Null);
    }

    JsonValue::String("<unsupported-type>".to_string())
}

fn json_to_mysql_param(value: &JsonValue) -> MySqlValue {
    match value {
        JsonValue::Null => MySqlValue::NULL,
        JsonValue::Bool(value) => MySqlValue::Int(if *value { 1 } else { 0 }),
        JsonValue::Number(number) => {
            if let Some(value) = number.as_i64() {
                MySqlValue::Int(value)
            } else if let Some(value) = number.as_u64() {
                MySqlValue::UInt(value)
            } else if let Some(value) = number.as_f64() {
                MySqlValue::Double(value)
            } else {
                MySqlValue::Bytes(number.to_string().into_bytes())
            }
        }
        JsonValue::String(value) => MySqlValue::Bytes(value.as_bytes().to_vec()),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            MySqlValue::Bytes(value.to_string().into_bytes())
        }
    }
}

async fn execute_redis_preview_payload(
    connection: &mut redis::aio::MultiplexedConnection,
    payload: &JsonValue,
    default_db_index: u32,
) -> Result<Option<JsonValue>, String> {
    let op = payload
        .get("op")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    if op != "preview-key" {
        return Ok(None);
    }

    let database = payload
        .get("database")
        .and_then(|value| value.as_str())
        .unwrap_or("db0");
    let key = payload
        .get("key")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if key.trim().is_empty() {
        return Err("Redis preview requires a key name.".to_string());
    }

    let db_index = parse_redis_database_name(database)?;
    if db_index != default_db_index {
        let _: String = redis::cmd("SELECT")
            .arg(db_index)
            .query_async(connection)
            .await
            .map_err(|error| format!("Redis database select failed: {error}"))?;
    }
    let key_type: String = redis::cmd("TYPE")
        .arg(key)
        .query_async(connection)
        .await
        .map_err(|error| format!("Redis TYPE failed for key '{key}': {error}"))?;
    let limit = payload
        .get("limit")
        .and_then(|value| value.as_i64())
        .map(|value| value.clamp(1, 10_000))
        .unwrap_or(200);
    let result = match key_type.as_str() {
        "string" => {
            let value: Option<String> = redis::cmd("GET")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|error| format!("Redis GET failed for key '{key}': {error}"))?;
            JsonValue::Array(vec![serde_json::json!({
                "key": key,
                "type": "string",
                "value": value
            })])
        }
        "hash" => {
            let entries: Vec<(String, String)> = redis::cmd("HGETALL")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|error| format!("Redis HGETALL failed for key '{key}': {error}"))?;
            JsonValue::Array(
                entries
                    .into_iter()
                    .map(|(field, value)| {
                        serde_json::json!({
                            "key": key,
                            "field": field,
                            "value": value
                        })
                    })
                    .collect(),
            )
        }
        "list" => {
            let items: Vec<String> = redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(limit - 1)
                .query_async(connection)
                .await
                .map_err(|error| format!("Redis LRANGE failed for key '{key}': {error}"))?;
            JsonValue::Array(
                items
                    .into_iter()
                    .enumerate()
                    .map(|(index, value)| {
                        serde_json::json!({
                            "key": key,
                            "index": index as i64,
                            "value": value
                        })
                    })
                    .collect(),
            )
        }
        "set" => {
            let items: Vec<String> = redis::cmd("SMEMBERS")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|error| format!("Redis SMEMBERS failed for key '{key}': {error}"))?;
            JsonValue::Array(
                items
                    .into_iter()
                    .map(|value| serde_json::json!({ "key": key, "value": value }))
                    .collect(),
            )
        }
        "zset" => {
            let items: Vec<String> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(limit - 1)
                .arg("WITHSCORES")
                .query_async(connection)
                .await
                .map_err(|error| format!("Redis ZRANGE failed for key '{key}': {error}"))?;
            let mut rows: Vec<JsonValue> = Vec::new();
            for chunk in items.chunks(2) {
                let value = chunk.get(0).cloned().unwrap_or_default();
                let score = chunk.get(1).cloned().unwrap_or_default();
                rows.push(serde_json::json!({
                    "key": key,
                    "value": value,
                    "score": score
                }));
            }
            JsonValue::Array(rows)
        }
        "stream" => {
            let value: redis::Value = redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(limit)
                .query_async(connection)
                .await
                .map_err(|error| format!("Redis XRANGE failed for key '{key}': {error}"))?;
            JsonValue::Array(vec![serde_json::json!({
                "key": key,
                "type": "stream",
                "entries": redis_value_to_json(value)
            })])
        }
        _ => {
            let value: redis::Value = match redis::cmd("GET")
                .arg(key)
                .query_async(connection)
                .await
            {
                Ok(value) => value,
                Err(_) => redis::Value::Nil,
            };
            JsonValue::Array(vec![serde_json::json!({
                "key": key,
                "type": key_type,
                "value": redis_value_to_json(value)
            })])
        }
    };

    Ok(Some(result))
}

fn parse_redis_database_name(schema: &str) -> Result<u32, String> {
    let normalized = schema.trim().to_lowercase();
    let db_part = normalized
        .strip_prefix("db")
        .unwrap_or(normalized.as_str())
        .trim();

    db_part
        .parse::<u32>()
        .map_err(|_| format!("Invalid Redis database name: '{schema}'. Expected values like db0."))
}

fn redis_default_database_index(client: &RedisClient) -> u32 {
    let db_index = client.get_connection_info().redis.db.max(0);
    u32::try_from(db_index).unwrap_or(0)
}

async fn redis_scan_keys(
    connection: &mut redis::aio::MultiplexedConnection,
    max_keys: usize,
) -> Result<Vec<String>, String> {
    let mut cursor: u64 = 0;
    let mut keys: Vec<String> = Vec::new();

    loop {
        let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg("*")
            .arg("COUNT")
            .arg(200)
            .query_async(connection)
            .await
            .map_err(|error| format!("Redis SCAN failed: {error}"))?;

        keys.extend(batch);

        if next_cursor == 0 || keys.len() >= max_keys {
            break;
        }

        cursor = next_cursor;
    }

    keys.sort();
    keys.dedup();
    keys.truncate(max_keys);
    Ok(keys)
}

fn parse_redis_command_tokens(command: &str) -> Vec<String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut quote_char = '\0';

    for character in trimmed.chars() {
        if in_quotes {
            if character == quote_char {
                in_quotes = false;
            } else {
                current.push(character);
            }
            continue;
        }

        if character == '"' || character == '\'' {
            in_quotes = true;
            quote_char = character;
            continue;
        }

        if character.is_whitespace() {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            continue;
        }

        current.push(character);
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn redis_value_to_json(value: redis::Value) -> JsonValue {
    match value {
        redis::Value::Nil => JsonValue::Null,
        redis::Value::Int(number) => JsonValue::Number(number.into()),
        redis::Value::BulkString(bytes) => match String::from_utf8(bytes.clone()) {
            Ok(text) => JsonValue::String(text),
            Err(_) => JsonValue::Array(bytes.into_iter().map(JsonValue::from).collect()),
        },
        redis::Value::Array(values) => {
            JsonValue::Array(values.into_iter().map(redis_value_to_json).collect())
        }
        redis::Value::SimpleString(value) => JsonValue::String(value),
        redis::Value::Okay => JsonValue::String("OK".to_string()),
        redis::Value::Map(entries) => JsonValue::Object(
            entries
                .into_iter()
                .map(|(key, value)| (json_value_to_plain_string(&redis_value_to_json(key)), redis_value_to_json(value)))
                .collect(),
        ),
        redis::Value::Set(values) => {
            JsonValue::Array(values.into_iter().map(redis_value_to_json).collect())
        }
        redis::Value::Double(number) => JsonNumber::from_f64(number)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        redis::Value::Boolean(value) => JsonValue::Bool(value),
        redis::Value::VerbatimString { text, .. } => JsonValue::String(text),
        redis::Value::BigNumber(value) => JsonValue::String(value.to_string()),
        redis::Value::Push { kind, data } => JsonValue::Object(
            [
                ("kind".to_string(), JsonValue::String(kind.to_string())),
                (
                    "data".to_string(),
                    JsonValue::Array(data.into_iter().map(redis_value_to_json).collect()),
                ),
            ]
            .into_iter()
            .collect(),
        ),
        redis::Value::Attribute { data, attributes } => JsonValue::Object(
            [
                ("data".to_string(), redis_value_to_json(*data)),
                (
                    "attributes".to_string(),
                    JsonValue::Array(
                        attributes
                            .into_iter()
                            .map(|(key, value)| {
                                JsonValue::Object(
                                    [
                                        ("key".to_string(), redis_value_to_json(key)),
                                        ("value".to_string(), redis_value_to_json(value)),
                                    ]
                                    .into_iter()
                                    .collect(),
                                )
                            })
                            .collect(),
                    ),
                ),
            ]
            .into_iter()
            .collect(),
        ),
        _ => JsonValue::String("<unsupported-redis-value>".to_string()),
    }
}

fn json_value_to_query_result(value: JsonValue, started: Instant) -> QueryResult {
    let (columns, rows) = json_value_to_rows(value);

    QueryResult {
        columns,
        row_count: rows.len(),
        rows,
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

fn json_value_to_rows(value: JsonValue) -> (Vec<QueryColumn>, Vec<JsonValue>) {
    match value {
        JsonValue::Array(entries) => {
            if entries
                .iter()
                .all(|entry| matches!(entry, JsonValue::Object(_)))
            {
                let mut ordered_column_names: Vec<String> = Vec::new();
                for entry in &entries {
                    if let JsonValue::Object(object) = entry {
                        for key in object.keys() {
                            if !ordered_column_names.contains(key) {
                                ordered_column_names.push(key.to_string());
                            }
                        }
                    }
                }

                let columns = ordered_column_names
                    .iter()
                    .map(|name| QueryColumn {
                        name: name.to_string(),
                        db_type: "json".to_string(),
                        nullable: true,
                    })
                    .collect();
                return (columns, entries);
            }

            let rows = entries
                .into_iter()
                .enumerate()
                .map(|(index, item)| {
                    serde_json::json!({
                        "index": index as i64,
                        "value": item
                    })
                })
                .collect::<Vec<JsonValue>>();
            let columns = vec![
                QueryColumn {
                    name: "index".to_string(),
                    db_type: "int".to_string(),
                    nullable: false,
                },
                QueryColumn {
                    name: "value".to_string(),
                    db_type: "json".to_string(),
                    nullable: true,
                },
            ];
            (columns, rows)
        }
        JsonValue::Object(object) => {
            let columns = object
                .keys()
                .map(|name| QueryColumn {
                    name: name.to_string(),
                    db_type: "json".to_string(),
                    nullable: true,
                })
                .collect();
            (columns, vec![JsonValue::Object(object)])
        }
        primitive => {
            let columns = vec![QueryColumn {
                name: "result".to_string(),
                db_type: "json".to_string(),
                nullable: true,
            }];
            let rows = vec![serde_json::json!({ "result": primitive })];
            (columns, rows)
        }
    }
}

fn json_value_to_plain_string(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "null".to_string(),
        JsonValue::Bool(boolean) => boolean.to_string(),
        JsonValue::Number(number) => number.to_string(),
        JsonValue::String(string) => string.to_string(),
        JsonValue::Array(_) | JsonValue::Object(_) => value.to_string(),
    }
}

fn json_value_to_mongo_document(value: &JsonValue) -> Option<MongoDocument> {
    match value {
        JsonValue::Object(_) => mongodb::bson::serialize_to_document(value).ok(),
        _ => None,
    }
}

fn mongo_document_to_json_value(document: MongoDocument) -> Result<JsonValue, String> {
    serde_json::to_value(document)
        .map_err(|error| format!("MongoDB JSON serialization failed: {error}"))
}

fn normalize_sql_server_host_input(raw_host: &str) -> Result<String, String> {
    let trimmed = raw_host.trim();
    if trimmed.is_empty() {
        return Err("SQL Server host is required.".into());
    }

    if trimmed.contains('\\') {
        return Err(
            "Named SQL Server instances in host (for example host\\\\SQLEXPRESS) are not supported yet. Use host/IP and explicit TCP port."
                .into(),
        );
    }

    let without_prefix = trimmed
        .strip_prefix("tcp:")
        .or_else(|| trimmed.strip_prefix("TCP:"))
        .unwrap_or(trimmed)
        .trim();
    let without_brackets = without_prefix
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(without_prefix)
        .trim();

    let host_without_port = if let Some((host, suffix)) = without_brackets.rsplit_once(':') {
        if !host.contains(':') && suffix.chars().all(|character| character.is_ascii_digit()) {
            host.trim()
        } else {
            without_brackets
        }
    } else {
        without_brackets
    };

    let host_without_comma_port = if let Some((host, suffix)) = host_without_port.rsplit_once(',') {
        if suffix.chars().all(|character| character.is_ascii_digit()) {
            host.trim()
        } else {
            host_without_port
        }
    } else {
        host_without_port
    };

    if host_without_comma_port.is_empty() {
        return Err("SQL Server host is invalid.".into());
    }

    Ok(host_without_comma_port.to_string())
}

fn sql_server_host_candidates(host: &str) -> Vec<&str> {
    if host.eq_ignore_ascii_case("localhost") || host == "." {
        vec!["localhost", "127.0.0.1"]
    } else {
        vec![host]
    }
}

fn sql_server_encryption_label(encryption: EncryptionLevel) -> &'static str {
    match encryption {
        EncryptionLevel::Required => "encrypt=required",
        EncryptionLevel::On => "encrypt=on",
        EncryptionLevel::Off => "encrypt=off",
        EncryptionLevel::NotSupported => "encrypt=not-supported",
    }
}

fn looks_like_resultset_query(sql: &str) -> bool {
    let normalized = sql.trim_start().to_lowercase();
    normalized.starts_with("select")
        || normalized.starts_with("show")
        || normalized.starts_with("describe")
        || normalized.starts_with("pragma")
        || normalized.starts_with("with")
        || normalized.starts_with("explain")
}

fn is_localhost_host(host: &str) -> bool {
    let normalized = host.trim().to_lowercase();
    normalized == "localhost"
        || normalized == "."
        || normalized == "::1"
        || normalized.starts_with("127.")
}

fn validate_connection_input(connection: &DesktopConnectionConfig) -> Result<(), String> {
    if connection.id.is_empty() {
        return Err("connection.id is required".into());
    }

    match connection.dialect.as_str() {
        "postgres" | "mysql" | "sqlserver" | "sqlite" | "redis" | "mongodb" => {}
        _ => {
            return Err(format!(
                "connection.dialect must be one of postgres, mysql, sqlserver, sqlite, redis, mongodb. Received '{}'.",
                connection.dialect
            ));
        }
    }

    if connection.database.is_empty() {
        return Err("connection.database is required".into());
    }

    if connection.dialect != "sqlite" {
        if connection.host.is_empty() {
            return Err("connection.host is required".into());
        }

        if connection.port == 0 {
            return Err("connection.port must be greater than zero".into());
        }

        if (connection.dialect == "postgres"
            || connection.dialect == "mysql"
            || connection.dialect == "sqlserver")
            && connection.user.is_empty()
        {
            return Err("connection.user is required".into());
        }
    }

    if connection.dialect == "postgres" {
        if let Some(preferred_tls_mode) = connection.preferred_tls_mode.as_deref() {
            if PostgresConnectMode::from_storage_value(preferred_tls_mode).is_none() {
                return Err(format!(
                    "connection.preferredTlsMode must be one of tls-verified-cert, tls-allow-invalid-cert, non-tls. Received '{}'.",
                    preferred_tls_mode
                ));
            }
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            db_connect,
            db_execute,
            db_cancel,
            db_list_schemas,
            db_list_tables,
            db_list_schema_objects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
