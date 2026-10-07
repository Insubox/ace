//! A self-contained human inspection artifact; never executes candidate source.
use crate::{Result, bounded_bytes, create_atomic, source};
use ace_core::ContentHash;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

fn script_json(value: &Value) -> Result<String> {
    Ok(serde_json::to_string(value)?
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029"))
}

pub(crate) fn export(run: &Path, output: &Path) -> Result<Value> {
    let report = ace_runner::load_report(run)?;
    let mut sources = BTreeMap::new();
    if run.join("sources.json").try_exists()? {
        for item in source::verify(run, &report)?.sources {
            let name = item.candidate.as_str();
            let bytes = bounded_bytes(&run.join(format!("sources/{name}.wat")), 32768)?;
            sources.insert(name.to_owned(), String::from_utf8(bytes)?);
        }
    }
    let report_hash = ContentHash::of_json(&report)?;
    let data = json!({"schema_version":1,"renderer":"ace-inspector-v1", "report_hash":report_hash,
        "report":report, "sources":sources});
    let html = include_str!("inspect.html").replace("__ACE_DATA__", &script_json(&data)?);
    create_atomic(output, html.as_bytes())?;
    Ok(
        json!({"output":output,"report_hash":report_hash,"candidates":report.results.len(),
        "verified_at_export":true,"offline":true,"candidate_execution":false}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn untrusted_text_cannot_close_the_data_script_or_inject_html() {
        let text = "</script><script>alert('source')</script>&\u{2028}\u{2029}";
        let encoded = script_json(&json!({"wat":text})).unwrap();
        assert!(!encoded.contains('<'));
        assert!(!encoded.contains('&'));
        assert_eq!(
            serde_json::from_str::<Value>(&encoded).unwrap()["wat"],
            text
        );
    }
}
