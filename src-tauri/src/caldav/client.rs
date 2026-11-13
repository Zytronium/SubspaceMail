use crate::caldav::types::{CalDavCalendar, CalDavConfig, CalDavEvent};
use reqwest::{Client, Method};

fn get_client() -> Client {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("Failed to build HTTP client")
}

fn basic_auth_header(username: &str, password: &str) -> String {
    use base64::Engine;
    let credentials = format!("{}:{}", username, password);
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(credentials))
}

fn propfind_method() -> Method {
    Method::from_bytes(b"PROPFIND").expect("PROPFIND is a valid method")
}

fn report_method() -> Method {
    Method::from_bytes(b"REPORT").expect("REPORT is a valid method")
}

/// Convert ISO 8601 timestamp (e.g., "2024-01-01T00:00:00Z") to iCalendar format
/// (e.g., "20240101T000000Z") as required by RFC 4791 Section 9.9
fn to_ical_timestamp(ts: &str) -> String {
    // Remove all dashes and colons from the timestamp
    // Input: "2024-01-01T00:00:00Z" -> Output: "20240101T000000Z"
    ts.replace(['-', ':'], "")
}

/// Discover the CalDAV root URL via /.well-known/caldav
async fn discover_caldav_root(config: &CalDavConfig) -> Result<String, String> {
    let client = get_client();
    let well_known_url = format!("{}/.well-known/caldav", config.server_url.trim_end_matches('/'));

    log::debug!("CalDAV service discovery: {}", well_known_url);

    // Try GET first (RFC 6764 specifies GET for .well-known discovery)
    let resp = client
        .get(&well_known_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .send()
        .await
        .map_err(|e| format!("Service discovery GET failed: {}", e))?;

    let status = resp.status();
    log::debug!("CalDAV discovery GET status: {}", status);

    if status.as_u16() >= 300 && status.as_u16() < 400 {
        if let Some(location) = resp.headers().get(reqwest::header::LOCATION) {
            let location_str = location.to_str().unwrap_or("");
            log::debug!("CalDAV discovery redirected to: {}", location_str);
            if location_str.starts_with('/') {
                let base = config.server_url.trim_end_matches('/');
                return Ok(format!("{}{}", base, location_str));
            }
            return Ok(location_str.to_string());
        }
    }

    // If GET returned success, the well-known URL itself might be the CalDAV root
    if status.is_success() {
        log::debug!("CalDAV discovery GET returned 200, using well-known URL");
        return Ok(well_known_url);
    }

    // Try PROPFIND as fallback (some servers only respond to PROPFIND)
    log::debug!("GET didn't redirect, trying PROPFIND");
    let resp = client
        .request(propfind_method(), &well_known_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .header("Content-Type", "text/xml;charset=UTF-8")
        .body(propfind_body().to_string())
        .send()
        .await
        .map_err(|e| format!("Service discovery PROPFIND failed: {}", e))?;

    let status = resp.status();
    if status.as_u16() >= 300 && status.as_u16() < 400 {
        if let Some(location) = resp.headers().get(reqwest::header::LOCATION) {
            let location_str = location.to_str().unwrap_or("");
            log::debug!("CalDAV discovery PROPFIND redirected to: {}", location_str);
            if location_str.starts_with('/') {
                let base = config.server_url.trim_end_matches('/');
                return Ok(format!("{}{}", base, location_str));
            }
            return Ok(location_str.to_string());
        }
    }

    // Fallback: use the server URL directly
    log::debug!("CalDAV discovery: no redirect found, falling back to server URL");
    Ok(config.server_url.trim_end_matches('/').to_string())
}

fn propfind_body() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
  </d:prop>
</d:propfind>"#
}

fn propfind_principal_body() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>"#
}

fn propfind_home_set_body() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>"#
}

/// Fetch the principal URL
async fn fetch_principal_url(
    client: &Client,
    config: &CalDavConfig,
    root_url: &str,
) -> Result<String, String> {
    let resp = client
        .request(propfind_method(), root_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .header("Content-Type", "text/xml;charset=UTF-8")
        .header("Depth", "0")
        .body(propfind_principal_body().to_string())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch principal URL: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("Failed to read principal response: {}", e))?;
    log::debug!("CalDAV principal response (status {}): {}", status, body.chars().take(500).collect::<String>());

    if !status.is_success() {
        return Err(format!(
            "Failed to fetch principal URL: HTTP {}",
            status
        ));
    }

    // Per RFC 4791, an empty href means the principal IS the requested URL
    let href = extract_href(&body, "current-user-principal");
    let principal = match href {
        Some(h) if !h.is_empty() => {
            if h.starts_with("http") {
                h
            } else if h.starts_with('/') {
                format!("{}{}", root_url.trim_end_matches('/'), h)
            } else {
                format!("{}/{}", root_url.trim_end_matches('/'), h)
            }
        }
        _ => {
            // Empty href or not found — the principal is the root URL itself
            log::debug!("CalDAV: no principal href found, using root URL as principal");
            root_url.to_string()
        }
    };

    // Ensure trailing slash for CalDAV collection resources
    Ok(if principal.ends_with('/') { principal } else { format!("{}/", principal) })
}

/// Fetch the calendar home set URL
async fn fetch_calendar_home_set(
    client: &Client,
    config: &CalDavConfig,
    principal_url: &str,
) -> Result<String, String> {
    log::debug!("CalDAV: fetching calendar home set from principal: {}", principal_url);
    let resp = client
        .request(propfind_method(), principal_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .header("Content-Type", "text/xml;charset=UTF-8")
        .header("Depth", "0")
        .body(propfind_home_set_body().to_string())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch calendar home set: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("Failed to read home set response: {}", e))?;
    log::debug!("CalDAV home set response (status {}): {}", status, body.chars().take(500).collect::<String>());

    if !status.is_success() {
        return Err(format!(
            "Failed to fetch calendar home set: HTTP {}",
            status
        ));
    }

    extract_href(&body, "calendar-home-set")
        .ok_or_else(|| "No calendar home set found in response".to_string())
        .map(|href| {
            if href.starts_with("http") {
                href
            } else if href.starts_with('/') {
                // Resolve relative path against the full base URL (scheme + host)
                resolve_href(&href, principal_url)
            } else {
                format!("{}/{}", principal_url.trim_end_matches('/'), href)
            }
        })
        .map(|home_set| {
            // Ensure trailing slash for CalDAV collection resources
            if home_set.ends_with('/') { home_set } else { format!("{}/", home_set) }
        })
}

/// Simple XML href extractor - finds the href after a property name
/// Handles both uppercase (D:href) and lowercase (d:href) namespace prefixes.
fn extract_href(body: &str, prop_name: &str) -> Option<String> {
    let prop_pos = body.find(prop_name)?;
    let after_prop = &body[prop_pos..];
    // Try uppercase first, then lowercase
    let (href_pos, tag_len) = if let Some(pos) = after_prop.find("<D:href>") {
        (pos, 8)
    } else if let Some(pos) = after_prop.find("<d:href>") {
        (pos, 8)
    } else {
        return None;
    };
    let start = href_pos + tag_len;
    let after_open = &after_prop[start..];
    // Try all combinations of closing tags (mixed case possible)
    let end_pos = after_open.find("</D:href>")
        .or_else(|| after_open.find("</d:href>"))
        .or_else(|| after_open.find("</D:HREF>"))
        .or_else(|| after_open.find("</d:HREF>"))?;
    let href = after_open[..end_pos].trim().to_string();
    // Return the href even if empty (empty href means the resource itself per RFC 4791)
    Some(href)
}

/// PROPFIND to list calendars in the calendar home set
async fn propfind_calendars(
    client: &Client,
    config: &CalDavConfig,
    home_set_url: &str,
) -> Result<Vec<CalDavCalendar>, String> {
    log::debug!("CalDAV: listing calendars at home_set_url: {}", home_set_url);
    
    // Validate URL before making request
    reqwest::Url::parse(home_set_url)
        .map_err(|e| format!("Failed to list calendars: builder error (invalid URL '{}'): {}", home_set_url, e))?;

    let propfind_calendars_body = r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:calendar-description/>
    <c:calendar-timezone/>
  </d:prop>
</d:propfind>"#;

    let resp = client
        .request(propfind_method(), home_set_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .header("Content-Type", "text/xml;charset=UTF-8")
        .header("Depth", "1")
        .body(propfind_calendars_body.to_string())
        .send()
        .await
        .map_err(|e| format!("Failed to list calendars: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("Failed to read calendars response: {}", e))?;

    if !status.is_success() {
        let body_preview: String = body.chars().take(200).collect();
        if status.as_u16() == 401 {
            return Err(format!(
                "CalDAV authentication failed (HTTP 401). Your server may require OAuth2 token authentication instead of Basic auth. Server response: {}",
                body_preview
            ));
        }
        return Err(format!("Failed to list calendars: HTTP {} - {}", status, body_preview));
    }

    parse_calendars_response(&body, home_set_url)
}

/// Parse the PROPFIND multistatus response to extract calendar information
/// Only includes resources that are actual CalDAV calendar collections (have <c:calendar> resourcetype)
fn parse_calendars_response(body: &str, home_set_url: &str) -> Result<Vec<CalDavCalendar>, String> {
    let mut calendars = Vec::new();

    // Handle both uppercase and lowercase namespace prefixes
    let parts: Vec<&str> = if body.contains("<D:response>") {
        body.split("<D:response>").collect()
    } else {
        body.split("<d:response>").collect()
    };

    for part in parts.iter().skip(1) {
        let href = match extract_first_href(part) {
            Some(h) => h,
            None => continue,
        };

        let normalized_href = href.trim_end_matches('/').to_string();
        let normalized_home = home_set_url.trim_end_matches('/').to_string();
        if normalized_href == normalized_home {
            continue;
        }

        // Only include actual CalDAV calendar collections, not other DAV resources
        // CalDAV servers use namespace prefixes for tags, e.g.:
        //   <d:resourcetype><c:calendar/></d:resourcetype>
        //   <D:resourcetype><C:calendar></C:calendar></D:resourcetype>
        // After lowercasing, we check for patterns like ":calendar>" and ":resourcetype>"
        // which match any namespace-prefixed tag (e.g., "c:calendar>", "d:resourcetype>").
        let part_lower = part.to_lowercase();
        // Check for resourcetype with any namespace prefix
        let has_resourcetype = part_lower.contains("<resourcetype>")
            || part_lower.contains("</resourcetype>")
            || part_lower.contains(":resourcetype>")
            || part_lower.contains(":resourcetype/>");
        if !has_resourcetype {
            log::debug!("CalDAV: skipping resource without resourcetype: {}", href);
            continue;
        }
        // Check for calendar with any namespace prefix
        let has_calendar = part_lower.contains("<calendar>")
            || part_lower.contains("</calendar>")
            || part_lower.contains(":calendar>")
            || part_lower.contains(":calendar/>");
        if !has_calendar {
            log::debug!("CalDAV: skipping non-calendar resource: {}", href);
            continue;
        }

        let display_name = extract_display_name(part).unwrap_or_else(|| "Calendar".to_string());

        let full_url = resolve_href(&href, home_set_url);
        log::debug!("CalDAV: found calendar '{}' at {}", display_name, full_url);

        calendars.push(CalDavCalendar {
            url: full_url,
            display_name,
            color: None,
        });
    }

    Ok(calendars)
}

fn extract_first_href(part: &str) -> Option<String> {
    // Try uppercase first, then lowercase
    let (href_pos, tag_len) = if let Some(pos) = part.find("<D:href>") {
        (pos, 8)
    } else if let Some(pos) = part.find("<d:href>") {
        (pos, 8)
    } else {
        return None;
    };
    let start = href_pos + tag_len;
    let after_open = &part[start..];
    // Try all combinations of closing tags (mixed case possible)
    let end_pos = after_open.find("</D:href>")
        .or_else(|| after_open.find("</d:href>"))
        .or_else(|| after_open.find("</D:HREF>"))
        .or_else(|| after_open.find("</d:HREF>"))?;
    let href = after_open[..end_pos].trim().to_string();
    if href.is_empty() {
        None
    } else {
        Some(href)
    }
}

fn extract_display_name(part: &str) -> Option<String> {
    // Try uppercase first, then lowercase
    let (name_pos, tag_len) = if let Some(pos) = part.find("<D:displayname>") {
        (pos, 15)
    } else if let Some(pos) = part.find("<d:displayname>") {
        (pos, 15)
    } else {
        return None;
    };
    let start = name_pos + tag_len;
    let after_open = &part[start..];
    // Try all combinations of closing tags (mixed case possible)
    let end_pos = after_open.find("</D:displayname>")
        .or_else(|| after_open.find("</d:displayname>"))
        .or_else(|| after_open.find("</D:DISPLAYNAME>"))
        .or_else(|| after_open.find("</d:DISPLAYNAME>"))?;
    let name = after_open[..end_pos].trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn resolve_href(href: &str, base_url: &str) -> String {
    if href.starts_with("http") {
        href.to_string()
    } else if href.starts_with('/') {
        // Extract scheme and host from base_url
        if let Some(slash_pos) = base_url.find("//") {
            let after_scheme = &base_url[slash_pos + 2..];
            if let Some(host_end) = after_scheme.find('/') {
                // base_url[..slash_pos + 2] already includes "://", so don't add it again
                format!(
                    "{}{}/{}",
                    &base_url[..slash_pos + 2],
                    &after_scheme[..host_end],
                    href.trim_start_matches('/')
                )
            } else {
                // No host found in base_url, just use scheme+host part with the href
                format!("{}{}", &base_url[..slash_pos + 2], href)
            }
        } else {
            href.to_string()
        }
    } else {
        format!("{}/{}", base_url.trim_end_matches('/'), href)
    }
}

/// Calendar QUERY to fetch events in a time range
async fn calendar_query(
    client: &Client,
    config: &CalDavConfig,
    calendar_url: &str,
    time_start: &str,
    time_end: &str,
) -> Result<Vec<CalDavEvent>, String> {
    // Remove trailing slash for REPORT requests - some servers (e.g., Stalwart) return 405
    // Method Not Allowed for REPORT on URLs with trailing slashes
    let cal_url = calendar_url.trim_end_matches('/').to_string();

    // Convert ISO 8601 timestamps (e.g., "2024-01-01T00:00:00Z") to iCalendar format
    // (e.g., "20240101T000000Z") as required by RFC 4791 Section 9.9
    let ical_start = to_ical_timestamp(time_start);
    let ical_end = to_ical_timestamp(time_end);

    let query_body = format!(
        r#"<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data>
      <C:comp name="VCALENDAR">
        <C:comp name="VEVENT">
          <C:allprop/>
        </C:comp>
      </C:comp>
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="{}" end="{}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#,
        ical_start, ical_end
    );

    log::debug!("CalDAV: querying events at URL: {}", cal_url);
    log::debug!("CalDAV: query body: {}", query_body);

    let resp = client
        .request(report_method(), &cal_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .header("Content-Type", "text/xml;charset=UTF-8")
        .header("Depth", "1")
        .body(query_body.clone())
        .send()
        .await
        .map_err(|e| format!("Calendar query failed: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("Failed to read query response: {}", e))?;
    log::debug!("CalDAV: query response status: {}, body (first 500 chars): {}", status, body.chars().take(500).collect::<String>());

    if !status.is_success() {
        let body_preview: String = body.chars().take(300).collect();
        return Err(format!(
            "Calendar query failed: HTTP {} - {}",
            status, body_preview
        ));
    }

    let event_urls = extract_event_urls(&body, &cal_url);

    let mut events = Vec::new();
    for url in event_urls {
        match fetch_event_by_url(client, config, &url).await {
            Ok(event) => events.push(event),
            Err(e) => log::warn!("Failed to fetch event {}: {}", url, e),
        }
    }

    Ok(events)
}

fn extract_event_urls(body: &str, calendar_url: &str) -> Vec<String> {
    let mut urls = Vec::new();
    // Handle both uppercase and lowercase namespace prefixes
    let parts: Vec<&str> = if body.contains("<D:response>") {
        body.split("<D:response>").collect()
    } else {
        body.split("<d:response>").collect()
    };

    for part in parts.iter().skip(1) {
        let href = match extract_first_href(part) {
            Some(h) => h,
            None => continue,
        };

        let normalized_href = href.trim_end_matches('/').to_string();
        let normalized_cal = calendar_url.trim_end_matches('/').to_string();
        if normalized_href == normalized_cal {
            continue;
        }

        urls.push(resolve_href(&href, calendar_url));
    }

    urls
}

async fn fetch_event_by_url(
    client: &Client,
    config: &CalDavConfig,
    event_url: &str,
) -> Result<CalDavEvent, String> {
    let resp = client
        .get(event_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch event: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Failed to fetch event: HTTP {}", resp.status()));
    }

    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"').to_string());

    let ical_data =
        resp.text().await.map_err(|e| format!("Failed to read event data: {}", e))?;

    Ok(CalDavEvent {
        url: event_url.to_string(),
        etag,
        ical_data,
    })
}

// ---- Public API ----

pub async fn test_connection(config: &CalDavConfig) -> Result<usize, String> {
    let calendars = list_calendars(config).await?;
    Ok(calendars.len())
}

pub async fn list_calendars(config: &CalDavConfig) -> Result<Vec<CalDavCalendar>, String> {
    let client = get_client();
    log::debug!("CalDAV: server_url from config: {}", config.server_url);

    // Validate server_url before proceeding
    reqwest::Url::parse(&config.server_url)
        .map_err(|e| format!("Invalid CalDAV server URL '{}': {}", config.server_url, e))?;

    let root_url = discover_caldav_root(config).await?;
    log::debug!("CalDAV root URL: {}", root_url);

    // Try to discover the principal URL via PROPFIND
    let principal_url = match fetch_principal_url(&client, config, &root_url).await {
        Ok(url) => url,
        Err(e) => {
            log::warn!("CalDAV: failed to fetch principal URL: {}, trying username-based URL", e);
            // Fallback: construct principal URL from username
            // URL-encode the username to handle special characters like @
            let username_path = percent_encoding::utf8_percent_encode(
                config.username.trim_end_matches('/'),
                percent_encoding::NON_ALPHANUMERIC,
            );
            format!("{}/{}/", root_url.trim_end_matches('/'), username_path)
        }
    };
    log::debug!("CalDAV principal URL: {}", principal_url);

    // Try to fetch calendar home set from the principal URL
    let home_set = match fetch_calendar_home_set(&client, config, &principal_url).await {
        Ok(url) => url,
        Err(e) => {
            log::warn!("CalDAV: failed to fetch calendar home set from principal: {}, trying root URL", e);
            // Fallback: try the root URL as the home set directly
            match fetch_calendar_home_set(&client, config, &root_url).await {
                Ok(url) => {
                    log::debug!("CalDAV: calendar home set found at root URL: {}", url);
                    url
                }
                Err(e2) => {
                    log::warn!("CalDAV: failed to fetch calendar home set from root: {}", e2);
                    // Last resort: assume the home set is the principal URL itself
                    log::debug!("CalDAV: using principal URL as calendar home set: {}", principal_url);
                    principal_url.clone()
                }
            }
        }
    };
    log::debug!("CalDAV calendar home set: {}", home_set);

    // Validate home_set URL before making request
    reqwest::Url::parse(&home_set)
        .map_err(|e| format!("Invalid calendar home set URL '{}': {}", home_set, e))?;
    
    log::debug!("CalDAV: calling propfind_calendars with home_set: {}", home_set);
    let calendars = propfind_calendars(&client, config, &home_set).await?;
    log::info!("CalDAV: found {} calendars", calendars.len());

    Ok(calendars)
}

pub async fn fetch_events(
    config: &CalDavConfig,
    calendar_url: &str,
    time_start: &str,
    time_end: &str,
) -> Result<Vec<CalDavEvent>, String> {
    let client = get_client();
    calendar_query(&client, config, calendar_url, time_start, time_end).await
}

pub async fn create_event(
    config: &CalDavConfig,
    calendar_url: &str,
    ical_data: &str,
) -> Result<CalDavEvent, String> {
    let client = get_client();

    let uuid_str = uuid::Uuid::new_v4().to_string();
    let filename = format!("{}.ics", uuid_str);
    let event_url = if calendar_url.ends_with('/') {
        format!("{}{}", calendar_url, filename)
    } else {
        format!("{}/{}", calendar_url, filename)
    };

    let resp = client
        .put(&event_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .header("Content-Type", "text/calendar; charset=utf-8")
        .body(ical_data.to_string())
        .send()
        .await
        .map_err(|e| format!("Failed to create event: {}", e))?;

    let status = resp.status();
    if !status.is_success() && status.as_u16() != 201 {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Failed to create event: HTTP {} - {}", status, body));
    }

    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"').to_string());

    Ok(CalDavEvent {
        url: event_url,
        etag,
        ical_data: ical_data.to_string(),
    })
}

pub async fn update_event(
    config: &CalDavConfig,
    event_url: &str,
    ical_data: &str,
    etag: Option<&str>,
) -> Result<(), String> {
    let client = get_client();

    let mut req = client
        .put(event_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password))
        .header("Content-Type", "text/calendar; charset=utf-8")
        .body(ical_data.to_string());

    if let Some(etag_val) = etag {
        req = req.header("If-Match", etag_val);
    }

    let resp = req.send().await.map_err(|e| format!("Failed to update event: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Failed to update event: HTTP {} - {}", status, body));
    }

    Ok(())
}

pub async fn delete_event(
    config: &CalDavConfig,
    event_url: &str,
    etag: Option<&str>,
) -> Result<(), String> {
    let client = get_client();

    let mut req = client
        .delete(event_url)
        .header("Authorization", basic_auth_header(&config.username, &config.password));

    if let Some(etag_val) = etag {
        req = req.header("If-Match", etag_val);
    }

    let resp = req.send().await.map_err(|e| format!("Failed to delete event: {}", e))?;

    let status = resp.status();
    if !status.is_success() && status.as_u16() != 204 {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Failed to delete event: HTTP {} - {}", status, body));
    }

    Ok(())
}
