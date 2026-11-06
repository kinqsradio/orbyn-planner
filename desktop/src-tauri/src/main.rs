//! The desktop shell of Orbyn Planner: a window around the web build, and nothing more.
//!
//! The page is the same app that runs in a browser. The shell may open the window, remember where
//! it was, give it a native menu and refuse to navigate anywhere but the app. It has two commands
//! for the page to call (`open_link`, http(s) only, and `save_export`, which always asks the person where to save), no plugins the page can reach, and no network code: the page talks to the
//! engine itself, as far as the content security policy in `tauri.conf.json` allows.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl};
use tauri_plugin_dialog::DialogExt;
use url::Url;

const TITLE: &str = "Orbyn Planner";
const WIDTH: f64 = 1280.0;
const HEIGHT: f64 = 820.0;
const MIN_WIDTH: f64 = 900.0;
const MIN_HEIGHT: f64 = 600.0;
/// Where `npm run dev` serves the web app; `tauri.conf.json` has the same address.
const DEV_URL: &str = "http://localhost:5173";

/// Whether the window may show `url`: the app's own pages, and in a debug build the dev server.
/// Everything else, the engine included, is for the page to fetch, never to navigate to.
fn may_show(url: &Url, debug: bool) -> bool {
    match url.scheme() {
        // macOS and Linux serve the build from tauri://localhost.
        "tauri" => url.host_str() == Some("localhost"),
        // Windows and Android serve it from http(s)://tauri.localhost.
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "http" if debug => {
            url.host_str() == Some("localhost") && url.port() == Some(5173) && url.username().is_empty()
        }
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// Whether `url` may be handed to the system browser: a plain http or https address, nothing else.
fn is_web_link(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.has_host() && url.username().is_empty() && url.password().is_none()
}

/// The page's one command: open a link in the system browser. It refuses anything but http(s).
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "not a web address".to_string())?;
    if !is_web_link(&parsed) {
        return Err("only http and https links open".to_string());
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

/// The largest export the page may hand over: far more than any planner holds, so a bug can't fill a disk.
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

/// Whether `name` is a file name the page may suggest for an export: a plain `.json` or `.ics` name, no path.
fn export_name_ok(name: &str) -> bool {
    (name.ends_with(".json") || name.ends_with(".ics"))
        && name.len() <= 100
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
}

/// The page's second command: save an export. The person always picks the place in the system's own save dialog (the page
/// can't choose a path); the answer is true when a file was written and false when they cancelled.
#[tauri::command]
async fn save_export(app: AppHandle, name: String, contents: String) -> Result<bool, String> {
    if !export_name_ok(&name) {
        return Err("not a name for an export".to_string());
    }
    if contents.len() > MAX_EXPORT_BYTES {
        return Err("too large to export".to_string());
    }
    let extension = if name.ends_with(".json") { "json" } else { "ics" };
    let Some(chosen) = app.dialog().file().set_file_name(&name).add_filter("Export", &[extension]).blocking_save_file() else {
        return Ok(false);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(true)
}

/// The standard menus: the app, Edit, View and Window. Editing and window items are the system's own,
/// so the shell has no handler for any of them.
fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    menu.append(&Submenu::with_items(
        app,
        TITLE,
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?)?;

    #[cfg(not(target_os = "macos"))]
    menu.append(&Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?, &PredefinedMenuItem::quit(app, None)?],
    )?)?;

    menu.append(&Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?)?;

    menu.append(&Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?)?;

    menu.append(&Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?)?;

    Ok(menu)
}

fn main() {
    let debug = cfg!(debug_assertions);
    tauri::Builder::default()
        // Remembers the window's size, position and whether it is maximised between runs.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Used by `open_link` only: the plugin's own commands are not in any capability, so the page cannot reach them.
        .plugin(tauri_plugin_opener::init())
        // Used by `save_export` only, the same way.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_link, save_export])
        .menu(menu)
        .setup(move |app| {
            // In development the window shows the dev server; otherwise the built app, which Tauri serves.
            let url = if debug {
                WebviewUrl::External(Url::parse(DEV_URL).expect("a valid dev URL"))
            } else {
                WebviewUrl::default()
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title(TITLE)
                .inner_size(WIDTH, HEIGHT)
                .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
                .on_navigation(move |url| may_show(url, debug))
                // A link that wants a new window gets none: the shell opens no other windows.
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run Orbyn Planner");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str, debug: bool) -> bool {
        may_show(&Url::parse(url).expect("url"), debug)
    }

    #[test]
    fn the_apps_own_pages_are_shown() {
        assert!(allowed("tauri://localhost/", false));
        assert!(allowed("tauri://localhost/tasks", false));
        assert!(allowed("http://tauri.localhost/today", false));
        assert!(allowed("https://tauri.localhost/", false));
        assert!(allowed("about:blank", false));
    }

    #[test]
    fn nothing_remote_is_shown_not_even_the_engine() {
        for url in [
            "https://example.com/",
            "http://localhost:8080/health",
            "http://127.0.0.1:8080/",
            "tauri://evil.example/",
            "http://tauri.localhost.evil.example/",
            "https://tauri.localhost.evil.example/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "about:srcdoc",
        ] {
            assert!(!allowed(url, false), "{url}");
            assert!(!allowed(url, true), "{url}");
        }
    }

    #[test]
    fn only_web_links_open_outside() {
        let ok = |u: &str| is_web_link(&Url::parse(u).expect("url"));
        assert!(ok("https://example.com/a?b=1"));
        assert!(ok("http://example.com/"));
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com/", "tauri://localhost/", "mailto:a@b.c", "https://user:pw@example.com/"] {
            if let Ok(u) = Url::parse(bad) {
                assert!(!is_web_link(&u), "{bad}");
            }
        }
        assert!(open_link("javascript:alert(1)".into()).is_err());
        assert!(open_link("not a url".into()).is_err());
    }

    #[test]
    fn only_plain_json_and_ics_names_are_saved() {
        for ok in ["orbyn-planner-2026-11-07.json", "orbyn-planner-2026-11-07.ics", "My planner.json"] {
            assert!(export_name_ok(ok), "{ok}");
        }
        for bad in ["", ".json", "a.txt", "../a.json", "a/b.json", "a\\b.ics", "a.json.exe", "a\n.json", &format!("{}.json", "x".repeat(100))] {
            assert!(!export_name_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn only_a_debug_build_shows_the_dev_server() {
        assert!(allowed("http://localhost:5173/", true));
        assert!(!allowed("http://localhost:5173/", false));
        assert!(!allowed("http://localhost:5174/", true));
        assert!(!allowed("http://localhost.evil.example:5173/", true));
        assert!(!allowed("https://localhost:5173/", true));
    }
}
