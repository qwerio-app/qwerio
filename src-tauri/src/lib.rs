use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequest {
    connection_id: String,
    sql: String,
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
    rows: Vec<serde_json::Value>,
    row_count: usize,
    elapsed_ms: u64,
}

#[tauri::command]
fn db_connect(connection_id: &str) -> Result<(), String> {
    if connection_id.is_empty() {
        return Err("connectionId is required".into());
    }

    Ok(())
}

#[tauri::command]
fn db_execute(req: QueryRequest) -> Result<QueryResult, String> {
    if req.connection_id.is_empty() {
        return Err("connectionId is required".into());
    }

    let lowered = req.sql.trim().to_lowercase();

    if !lowered.starts_with("select") {
        return Ok(QueryResult {
            columns: vec![QueryColumn {
                name: "status".into(),
                db_type: "text".into(),
                nullable: false,
            }],
            rows: vec![serde_json::json!({
                "status": "Desktop scaffold accepts SELECT only until driver integration is implemented"
            })],
            row_count: 1,
            elapsed_ms: 7,
        });
    }

    Ok(QueryResult {
        columns: vec![
            QueryColumn {
                name: "id".into(),
                db_type: "int4".into(),
                nullable: false,
            },
            QueryColumn {
                name: "name".into(),
                db_type: "text".into(),
                nullable: false,
            },
            QueryColumn {
                name: "runtime".into(),
                db_type: "text".into(),
                nullable: false,
            },
        ],
        rows: vec![
            serde_json::json!({"id": 1, "name": "Desktop Demo", "runtime": "tauri"}),
            serde_json::json!({"id": 2, "name": "Native Query Engine", "runtime": "tauri"}),
        ],
        row_count: 2,
        elapsed_ms: 12,
    })
}

#[tauri::command]
fn db_cancel(_request_id: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn db_list_schemas(connection_id: &str) -> Result<Vec<Schema>, String> {
    if connection_id.is_empty() {
        return Err("connectionId is required".into());
    }

    Ok(vec![
        Schema {
            name: "public".into(),
        },
        Schema {
            name: "analytics".into(),
        },
    ])
}

#[tauri::command]
fn db_list_tables(connection_id: &str, schema: &str) -> Result<Vec<TableName>, String> {
    if connection_id.is_empty() {
        return Err("connectionId is required".into());
    }

    let tables = match schema {
        "analytics" => vec![
            TableName {
                name: "query_logs".into(),
            },
            TableName {
                name: "daily_rollups".into(),
            },
        ],
        _ => vec![
            TableName {
                name: "users".into(),
            },
            TableName {
                name: "projects".into(),
            },
        ],
    };

    Ok(tables)
}

#[derive(Debug, Serialize)]
struct Schema {
    name: String,
}

#[derive(Debug, Serialize)]
struct TableName {
    name: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            db_connect,
            db_execute,
            db_cancel,
            db_list_schemas,
            db_list_tables,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
