//! The desktop shell of Orbyn Planner: a window around the web build, and nothing more.
//!
//! The page is the same app that runs in a browser. The shell may open the window, remember where
//! it was, give it a native menu and refuse to navigate anywhere but the app. It has no commands
//! for the page to call, no plugins the page can reach, and no network code: the page talks to the
//! engine itself, as far as the content security policy in `tauri.conf.json` allows.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl};
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
    fn only_a_debug_build_shows_the_dev_server() {
        assert!(allowed("http://localhost:5173/", true));
        assert!(!allowed("http://localhost:5173/", false));
        assert!(!allowed("http://localhost:5174/", true));
        assert!(!allowed("http://localhost.evil.example:5173/", true));
        assert!(!allowed("https://localhost:5173/", true));
    }
}
