use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent};

const DEFAULT_PORT: u16 = 8756;
// Windows CreateProcess flag: run the console-mode sidecar without popping a terminal window. The
// child keeps its own hidden console so uvicorn's stdout logging still works.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// Dev: run the FastAPI sidecar using the uv-managed venv python directly.
// ponytail: run the venv python (not `uv run`) so the Child handle IS the sidecar and
// kill-on-exit actually kills it — `uv run` would leave python orphaned as a grandchild.
// Windows-only venv path; the packaged app uses spawn_sidecar_release instead.
fn spawn_sidecar_dev(port: u16) -> std::io::Result<Child> {
    let pipeline_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("services")
        .join("pipeline");
    let python = pipeline_dir.join(".venv").join("Scripts").join("python.exe");
    Command::new(python)
        .current_dir(&pipeline_dir)
        .args(["-m", "api.main", "--port", &port.to_string()])
        .spawn()
}

/// Release: run the PyInstaller-frozen sidecar bundled as a resource, with the DB and .env in the
/// per-user app-data dir (Program Files is read-only). The dir is created if missing; an empty DB
/// auto-migrates on first connect, and keys come from <app_data>/.env if the user placed one there.
fn spawn_sidecar_release(app: &AppHandle, port: u16) -> std::io::Result<Child> {
    let data_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("no app data dir: {e}")))?;
    std::fs::create_dir_all(&data_dir)?;
    let exe = app
        .path()
        .resource_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("no resource dir: {e}")))?
        .join("binaries")
        .join("habit-sidecar.exe");
    Command::new(exe)
        .current_dir(&data_dir)
        .env("HC_DB_PATH", data_dir.join("habit.db"))
        .env("HC_ENV_FILE", data_dir.join(".env"))
        .args(["--port", &port.to_string()])
        .creation_flags(CREATE_NO_WINDOW)  // no console window for the packaged app
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
            let spawned = if cfg!(debug_assertions) {
                spawn_sidecar_dev(port)
            } else {
                spawn_sidecar_release(app.handle(), port)
            };
            match spawned {
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
