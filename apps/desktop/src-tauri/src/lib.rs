#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // GUI로 실행되면 로그인 셸 PATH가 없어 로컬 CLI(claude 등)를 찾지 못한다
  let _ = fix_path_env::fix();

  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
