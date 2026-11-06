fn main() {
    // The page may call exactly one command of ours, `open_link`; see capabilities/main.json.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["open_link"])),
    )
    .expect("build the Tauri app");
}
