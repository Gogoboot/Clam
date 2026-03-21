// use std::path::PathBuf;
// use tauri::path::BaseDirectory;
// use tauri::Env;

// pub fn get_binary_path(env: &Env) -> PathBuf {
//     if env.dev() {
//         // Режим разработки: ищем рядом с проектом
//         let mut path = std::env::current_dir().expect("current dir");
//         path.push("src-tauri");
//         path.push("bin");
//         path.push(if cfg!(target_os = "windows") {
//             "whisper-cli.exe"
//         } else {
//             "whisper-cli"
//         });
//         path
//     } else {
//         // В собранном приложении sidecar находится в ресурсах
//         env.current_dir()
//             .join("bin")
//             .join(if cfg!(target_os = "windows") { "whisper-cli.exe" } else { "whisper-cli" })
//     }
// }

// pub fn get_models_dir(env: &Env) -> PathBuf {
//     if env.dev() {
//         let mut path = std::env::current_dir().expect("current dir");
//         path.push("src-tauri");
//         path.push("models");
//         path
//     } else {
//         env.current_dir().join("models")
//     }
// }
