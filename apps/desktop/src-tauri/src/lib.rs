use std::path::Path;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

const DEFAULT_PORT: u16 = 8756;

/// Holds the sidecar child so it can be killed on exit.
struct Sidecar(Mutex<Option<Child>>);

fn sidecar_port_value() -> u16 {
    std::env::var("HC_SIDECAR_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Frontend asks the host which loopback port the sidecar listens on.
#[tauri::command]
fn sidecar_port() -> u16 {
    sidecar_port_value()
}

/// Dev: run the FastAPI sidecar via `uv` from the pipeline directory.
// ponytail: dev spawns `uv run`; swap for the PyInstaller-frozen sidecar binary before packaging.
fn spawn_sidecar(port: u16) -> std::io::Result<Child> {
    let pipeline_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("services")
        .join("pipeline");
    Command::new("uv")
        .current_dir(pipeline_dir)
        .args(["run", "python", "-m", "api.main", "--port", &port.to_string()])
        .spawn()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = sidecar_port_value();
    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![sidecar_port])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            match spawn_sidecar(port) {
                Ok(child) => *app.state::<Sidecar>().0.lock().unwrap() = Some(child),
                Err(e) => log::error!("failed to spawn sidecar: {e}"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app_handle.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
