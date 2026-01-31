use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    pub pinned: bool,
    pub is_list: bool,
    pub updated_at: i64,
}

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn init(app_handle: &tauri::AppHandle) -> Result<Self> {
        let app_dir = app_handle.path().app_data_dir().expect("Failed to get app data dir");
        fs::create_dir_all(&app_dir).expect("Failed to create app data directory");
        
        let db_path = app_dir.join("app_notas.db");
        let conn = Connection::open(db_path)?;

        // Simplified migration: ensure columns exist
        conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '#ffffff',
                pinned INTEGER NOT NULL DEFAULT 0,
                is_list INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        // Scope the borrow of conn
        {
            let mut stmt = conn.prepare("PRAGMA table_info(notes)")?;
            let columns = stmt.query_map([], |row| {
                let name: String = row.get(1)?;
                Ok(name)
            })?;

            let mut has_title = false;
            for col in columns {
                if col? == "title" {
                    has_title = true;
                    break;
                }
            }

            if !has_title {
                conn.execute("ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT ''", [])?;
                conn.execute("ALTER TABLE notes ADD COLUMN color TEXT NOT NULL DEFAULT '#ffffff'", [])?;
                conn.execute("ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", [])?;
                conn.execute("ALTER TABLE notes ADD COLUMN is_list INTEGER NOT NULL DEFAULT 0", [])?;
            }
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )?;

        Ok(Self { conn })
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?")?;
        let mut rows = stmt.query([key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            [key, value],
        )?;
        Ok(())
    }

    pub fn save_note(&self, note: &Note) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO notes (id, title, content, color, pinned, is_list, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&note.id, &note.title, &note.content, &note.color, if note.pinned { 1 } else { 0 }, if note.is_list { 1 } else { 0 }, &note.updated_at),
        )?;
        Ok(())
    }

    pub fn list_notes(&self) -> Result<Vec<Note>> {
        let mut stmt = self.conn.prepare("SELECT id, title, content, color, pinned, is_list, updated_at FROM notes ORDER BY pinned DESC, updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                color: row.get(3)?,
                pinned: row.get::<_, i32>(4)? != 0,
                is_list: row.get::<_, i32>(5)? != 0,
                updated_at: row.get(6)?,
            })
        })?;

        let mut notes = Vec::new();
        for note in rows {
            notes.push(note?);
        }
        Ok(notes)
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(())
    }
}
