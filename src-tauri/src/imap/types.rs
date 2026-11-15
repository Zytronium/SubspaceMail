use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub security: String, // "tls", "starttls", "none"
    pub username: String,
    pub password: String, // plaintext password or OAuth2 access token
    pub auth_method: String, // "password" or "oauth2"
    #[serde(default)]
    pub accept_invalid_certs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolder {
    pub path: String,      // decoded UTF-8 display name
    pub raw_path: String,  // original modified UTF-7 path for IMAP commands
    pub name: String,      // decoded display name (last segment)
    pub delimiter: String,
    pub special_use: Option<String>, // "\Sent", "\Trash", "\Drafts", "\Junk", "\Archive", "\All"
    pub exists: u32,
    pub unseen: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapMessage {
    pub uid: u32,
    pub folder: String,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub from_address: Option<String>,
    pub from_name: Option<String>,
    pub to_addresses: Option<String>,
    pub cc_addresses: Option<String>,
    pub bcc_addresses: Option<String>,
    pub reply_to: Option<String>,
    pub subject: Option<String>,
    pub date: i64,
    pub is_read: bool,
    pub is_starred: bool,
    pub is_draft: bool,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub snippet: Option<String>,
    pub raw_size: u32,
    pub list_unsubscribe: Option<String>,
    pub list_unsubscribe_post: Option<String>,
    pub auth_results: Option<String>,
    pub attachments: Vec<ImapAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapAttachment {
    pub part_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u32,
    pub content_id: Option<String>,
    pub is_inline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolderStatus {
    pub uidvalidity: u32,
    pub uidnext: u32,
    pub exists: u32,
    pub unseen: u32,
    pub highest_modseq: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFetchResult {
    pub messages: Vec<ImapMessage>,
    pub folder_status: ImapFolderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolderSyncResult {
    pub uids: Vec<u32>,
    pub messages: Vec<ImapMessage>,
    pub folder_status: ImapFolderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolderSearchResult {
    pub uids: Vec<u32>,
    pub folder_status: ImapFolderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaCheckRequest {
    pub folder: String,
    pub last_uid: u32,
    pub uidvalidity: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaCheckResult {
    pub folder: String,
    pub uidvalidity: u32,
    pub new_uids: Vec<u32>,
    pub uidvalidity_changed: bool,
}

// ---------- Full sync types (single-connection sync for all folders) ----------

/// Request for a full sync operation that does everything in one IMAP connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSyncRequest {
    /// Optional SINCE date filter for initial sync (format `DD-Mon-YYYY`).
    /// If provided, uses initial sync mode. If None, uses delta sync mode.
    pub since_date: Option<String>,
    /// Batch size for UID FETCH operations.
    pub batch_size: u32,
    /// Delta check state for existing folders (used when since_date is None).
    pub delta_folders: Vec<DeltaCheckRequest>,
}

/// Result of syncing a single folder within a full sync operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSyncFolderResult {
    pub folder: String,
    pub uids: Vec<u32>,
    pub messages: Vec<ImapMessage>,
    pub folder_status: ImapFolderStatus,
    /// True if UIDVALIDITY changed and a full resync was performed.
    pub uidvalidity_changed: bool,
}

/// Result of a full sync operation covering all folders in one connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSyncResult {
    /// All folders available on the server.
    pub folders: Vec<ImapFolder>,
    /// Per-folder sync results.
    pub folder_results: Vec<FullSyncFolderResult>,
}
