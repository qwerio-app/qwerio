use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use keyring::Entry;
use mysql_async::prelude::Queryable;
use mysql_async::{OptsBuilder, Pool, Row as MySqlRow, Value as MySqlValue};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use tokio::sync::RwLock;
use tokio_postgres::types::ToSql;
use tokio_postgres::{Client as PgClient, NoTls};

const KEYRING_SERVICE: &str = "qwerio.credentials";

#[derive(Default)]
struct AppState {
    connections: RwLock<HashMap<String, DbConnection>>,
}

#[derive(Clone)]
enum DbConnection {
    Postgres(Arc<PgClient>),
    MySql(Pool),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConnectionConfig {
    id: String,
    dialect: String,
    host: String,
    port: u16,
    database: String,
    user: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequest {
    connection_id: String,
    sql: String,
    params: Option<Vec<JsonValue>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSecret {
    kind: String,
    #[serde(default)]
    password: Option<String>,
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
fn secret_store(connection_id: &str, secret_json: &str) -> Result<(), String> {
    let entry = keyring_entry(connection_id)?;
    entry
        .set_password(secret_json)
        .map_err(|error| format!("Failed to store credentials: {error}"))
}

#[tauri::command]
fn secret_load(connection_id: &str) -> Result<Option<String>, String> {
    let entry = keyring_entry(connection_id)?;

    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to load credentials: {error}")),
    }
}

#[tauri::command]
fn secret_delete(connection_id: &str) -> Result<(), String> {
    let entry = keyring_entry(connection_id)?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete credentials: {error}")),
    }
}

#[tauri::command]
async fn db_connect(
    connection: DesktopConnectionConfig,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    validate_connection_input(&connection)?;
    let secret = load_desktop_secret(&connection.id)?;
    let password = secret.as_ref().and_then(|stored| stored.password.as_deref());

    let db_connection = match connection.dialect.as_str() {
        "postgres" => DbConnection::Postgres(Arc::new(
            connect_postgres(&connection, password).await?,
        )),
        "mysql" => DbConnection::MySql(connect_mysql(&connection, password).await?),
        _ => return Err(format!("Unsupported dialect: {}", connection.dialect)),
    };

    let mut guard = state.connections.write().await;
    guard.insert(connection.id, db_connection);

    Ok(())
}

#[tauri::command]
async fn db_execute(req: QueryRequest, state: tauri::State<'_, AppState>) -> Result<QueryResult, String> {
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
        DbConnection::Postgres(client) => execute_postgres(client.as_ref(), &req.sql, req.params.as_deref()).await,
        DbConnection::MySql(pool) => execute_mysql(&pool, &req.sql, req.params.as_deref()).await,
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
                .query(
                    "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
                )
                .await
                .map_err(|error| format!("MySQL schema listing failed: {error}"))?;

            Ok(rows.into_iter().map(|(name,)| Schema { name }).collect())
        }
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
    }
}

async fn connect_postgres(
    config: &DesktopConnectionConfig,
    password: Option<&str>,
) -> Result<PgClient, String> {
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

    match connect_postgres_config(pg_config).await {
        Ok(client) => return Ok(client),
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

                    match connect_postgres_config(socket_cfg).await {
                        Ok(client) => return Ok(client),
                        Err(socket_error) => socket_errors.push(format!("{socket_dir}: {socket_error}")),
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

async fn connect_mysql(config: &DesktopConnectionConfig, password: Option<&str>) -> Result<Pool, String> {
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
                let socket_paths = ["/var/run/mysqld/mysqld.sock", "/run/mysqld/mysqld.sock", "/tmp/mysql.sock"];
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

async fn connect_postgres_config(config: tokio_postgres::Config) -> Result<PgClient, String> {
    let (client, connection) = config
        .connect(NoTls)
        .await
        .map_err(|error| error.to_string())?;

    tokio::spawn(async move {
        if let Err(error) = connection.await {
            eprintln!("postgres connection task ended with error: {error}");
        }
    });

    Ok(client)
}

async fn verify_mysql_pool(pool: Pool) -> Result<Pool, String> {
    let mut conn = pool.get_conn().await.map_err(|error| error.to_string())?;
    conn.ping().await.map_err(|error| error.to_string())?;
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
    let bind_refs: Vec<&(dyn ToSql + Sync)> =
        bind_params.iter().map(|value| value.as_ref() as &(dyn ToSql + Sync)).collect();

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
            Err(_) => JsonValue::Array(bytes.into_iter().map(|byte| JsonValue::from(byte)).collect()),
        },
        MySqlValue::Int(value) => JsonValue::Number(value.into()),
        MySqlValue::UInt(value) => JsonValue::Number(value.into()),
        MySqlValue::Float(value) => JsonNumber::from_f64(value as f64)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        MySqlValue::Double(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        MySqlValue::Date(year, month, day, hour, minute, second, micros) => JsonValue::String(format!(
            "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{:06}",
            micros
        )),
        MySqlValue::Time(is_negative, days, hours, minutes, seconds, micros) => JsonValue::String(format!(
            "{}{days}d {hours:02}:{minutes:02}:{seconds:02}.{:06}",
            if is_negative { "-" } else { "" },
            micros
        )),
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
        object.insert(column.name().to_string(), postgres_cell_to_json(&row, index));
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
        return value.map(|number| JsonValue::Number(number.into())).unwrap_or(JsonValue::Null);
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
        JsonValue::Array(_) | JsonValue::Object(_) => MySqlValue::Bytes(value.to_string().into_bytes()),
    }
}

fn looks_like_resultset_query(sql: &str) -> bool {
    let normalized = sql.trim_start().to_lowercase();
    normalized.starts_with("select")
        || normalized.starts_with("show")
        || normalized.starts_with("describe")
        || normalized.starts_with("with")
        || normalized.starts_with("explain")
}

fn is_localhost_host(host: &str) -> bool {
    let normalized = host.trim().to_lowercase();
    normalized == "localhost"
        || normalized == "::1"
        || normalized.starts_with("127.")
}

fn validate_connection_input(connection: &DesktopConnectionConfig) -> Result<(), String> {
    if connection.id.is_empty() {
        return Err("connection.id is required".into());
    }

    if connection.host.is_empty() {
        return Err("connection.host is required".into());
    }

    if connection.database.is_empty() {
        return Err("connection.database is required".into());
    }

    if connection.user.is_empty() {
        return Err("connection.user is required".into());
    }

    Ok(())
}

fn keyring_entry(connection_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, connection_id)
        .map_err(|error| format!("Failed to initialize keyring entry: {error}"))
}

fn load_desktop_secret(connection_id: &str) -> Result<Option<DesktopSecret>, String> {
    let entry = keyring_entry(connection_id)?;

    let secret = match entry.get_password() {
        Ok(secret) => secret,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Unable to read credentials for {connection_id}: {error}"
            ))
        }
    };

    let parsed = serde_json::from_str::<DesktopSecret>(&secret)
        .map_err(|error| format!("Invalid credential format for {connection_id}: {error}"))?;

    if parsed.kind != "desktop-tcp" {
        return Err("Stored credentials are not for a desktop TCP connection.".into());
    }

    Ok(Some(parsed))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            secret_store,
            secret_load,
            secret_delete,
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
