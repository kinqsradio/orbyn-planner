fn main() {
    // The page may call exactly two commands of ours, `open_link` and `save_export`; see capabilities/main.json.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["open_link", "save_export"])),
    )
    .expect("build the Tauri app");
}
