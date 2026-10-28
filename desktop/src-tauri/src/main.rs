// Atlas voor Windows: een venster rond de Atlas-pagina van de server, met systeemvak en autostart.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Url, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

// Bij autostart opent Atlas stil in het systeemvak.
const VERBORGEN: &str = "--verborgen";

#[cfg(windows)]
const INSTELLINGEN: &str = "http://tauri.localhost/index.html#instellen";
#[cfg(not(windows))]
const INSTELLINGEN: &str = "tauri://localhost/index.html#instellen";

fn toon(app: &AppHandle) {
    if let Some(venster) = app.get_webview_window("main") {
        let _ = venster.unminimize();
        let _ = venster.show();
        let _ = venster.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| toon(app)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![VERBORGEN]),
        ))
        .setup(|app| {
            let autostart = app.autolaunch();
            if !autostart.is_enabled().unwrap_or(false) {
                let _ = autostart.enable();
            }

            if std::env::args().any(|arg| arg == VERBORGEN) {
                if let Some(venster) = app.get_webview_window("main") {
                    let _ = venster.hide();
                }
            }

            let openen = MenuItem::with_id(app, "openen", "Atlas openen", true, None::<&str>)?;
            let adres = MenuItem::with_id(app, "adres", "Server-adres wijzigen", true, None::<&str>)?;
            let afsluiten = MenuItem::with_id(app, "afsluiten", "Afsluiten", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&openen, &adres, &afsluiten])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Atlas")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "openen" => toon(app),
                    "adres" => {
                        if let (Some(venster), Ok(url)) =
                            (app.get_webview_window("main"), INSTELLINGEN.parse::<Url>())
                        {
                            let _ = venster.navigate(url);
                        }
                        toon(app);
                    }
                    "afsluiten" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toon(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Sluiten verstopt het venster in het systeemvak; afsluiten gaat via het menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Atlas kon niet starten");
}
