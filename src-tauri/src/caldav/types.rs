use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalDavConfig {
    pub server_url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalDavCalendar {
    pub url: String,
    pub display_name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalDavEvent {
    pub url: String,
    pub etag: Option<String>,
    pub ical_data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalDavCreateEventInput {
    pub calendar_url: String,
    pub summary: String,
    pub description: String,
    pub location: String,
    pub start_time: String,
    pub end_time: String,
    pub all_day: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalDavUpdateEventInput {
    pub event_url: String,
    pub etag: Option<String>,
    pub calendar_url: String,
    pub summary: String,
    pub description: String,
    pub location: String,
    pub start_time: String,
    pub end_time: String,
    pub all_day: bool,
}
