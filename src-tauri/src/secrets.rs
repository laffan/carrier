//! Secret storage for OAuth refresh tokens.
//!
//! On macOS and iOS secrets live in the system Keychain. On other platforms
//! (only used for development) they fall back to a JSON file in the app data
//! directory.

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
use tauri::Manager;

const SERVICE: &str = "app.carrier.mail";

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use super::SERVICE;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    // errSecItemNotFound
    const NOT_FOUND: i32 = -25300;

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match get_generic_password(SERVICE, key) {
            Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|e| e.to_string()),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        set_generic_password(SERVICE, key, value.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn delete(key: &str) -> Result<(), String> {
        match delete_generic_password(SERVICE, key) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod imp {
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn load(path: &PathBuf) -> HashMap<String, String> {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(path: &PathBuf, map: &HashMap<String, String>) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string(map).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn get(path: PathBuf, key: &str) -> Result<Option<String>, String> {
        Ok(load(&path).get(key).cloned())
    }

    pub fn set(path: PathBuf, key: &str, value: &str) -> Result<(), String> {
        let mut map = load(&path);
        map.insert(key.to_string(), value.to_string());
        save(&path, &map)
    }

    pub fn delete(path: PathBuf, key: &str) -> Result<(), String> {
        let mut map = load(&path);
        map.remove(key);
        save(&path, &map)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn secrets_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("secrets.dev.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let _ = &app;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::get(&key);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    return imp::get(secrets_path(&app)?, &key);
}

#[tauri::command]
pub fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let _ = &app;
    let _ = SERVICE;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::set(&key, &value);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    return imp::set(secrets_path(&app)?, &key, &value);
}

#[tauri::command]
pub fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let _ = &app;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::delete(&key);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    return imp::delete(secrets_path(&app)?, &key);
}
