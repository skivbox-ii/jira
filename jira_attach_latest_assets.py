#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

UA = "ujg-jira-assets-sync/1.0"


def http(url, *, method="GET", headers=None, data=None, insecure=False, timeout=60):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    ctx = ssl._create_unverified_context() if insecure else None  # noqa: SLF001
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:  # noqa: S310
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def get_json(url, *, headers, insecure=False):
    code, body = http(url, headers=headers, insecure=insecure)
    if code >= 400:
        raise SystemExit(f"HTTP {code}: {url}\n{body[:2000].decode(errors='replace')}")
    return json.loads(body.decode("utf-8"))


def get_bytes(url, *, headers, insecure=False):
    code, body = http(url, headers=headers, insecure=insecure)
    if code >= 400:
        raise SystemExit(f"HTTP {code}: {url}\n{body[:2000].decode(errors='replace')}")
    return body


def github_latest_sha(repo, ref, *, insecure=False):
    h = {"User-Agent": UA, "Accept": "application/vnd.github+json"}
    if ref:
        return get_json(f"https://api.github.com/repos/{repo}/commits/{ref}", headers=h, insecure=insecure)["sha"]
    default_branch = get_json(f"https://api.github.com/repos/{repo}", headers=h, insecure=insecure).get("default_branch", "main")
    return get_json(f"https://api.github.com/repos/{repo}/commits/{default_branch}", headers=h, insecure=insecure)["sha"]


def multipart(files):
    boundary = "----ujg" + uuid4().hex
    parts = []
    for filename, content in files:
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        parts += [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
            f"Content-Type: {ctype}\r\n\r\n".encode(),
            content,
            b"\r\n",
        ]
    parts.append(f"--{boundary}--\r\n".encode())
    return boundary, b"".join(parts)


def jira_attach(jira_base, issue_key, user, token, files, *, insecure=False):
    auth = base64.b64encode(f"{user}:{token}".encode("utf-8")).decode("ascii")
    boundary, body = multipart(files)
    base_headers = {
        "User-Agent": UA,
        "Authorization": f"Basic {auth}",
        "X-Atlassian-Token": "no-check",
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    for api_ver in ("3", "2"):
        url = f"{jira_base.rstrip('/')}/rest/api/{api_ver}/issue/{issue_key}/attachments"
        code, resp = http(url, method="POST", headers=base_headers, data=body, insecure=insecure, timeout=120)
        if code == 404:
            continue
        if code >= 400:
            raise SystemExit(f"Jira upload failed HTTP {code}\n{resp[:4000].decode(errors='replace')}")
        return json.loads(resp.decode("utf-8"))
    raise SystemExit("Jira upload failed: endpoint not found (tried /rest/api/3 and /rest/api/2).")


def main():
    p = argparse.ArgumentParser(
        description="Скачивает последние файлы из GitHub (без auth) и прикрепляет к задаче Jira как attachments.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--repo", default=os.getenv("GITHUB_REPO", "skivbox-ii/jira"), help="owner/repo")
    p.add_argument("--ref", default=os.getenv("GITHUB_REF"), help="ветка/тег/sha (если не задано — берём default branch)")
    p.add_argument("--files", nargs="+", default=["ujg-sprint-health.js", "ujg-timesheet.css"], help="пути файлов в репо")
    p.add_argument("--jira", default=os.getenv("JIRA_BASE_URL"), help="база Jira, напр. https://company.atlassian.net")
    p.add_argument("--issue", default=os.getenv("JIRA_ISSUE_KEY"), help="ключ задачи, напр. SDKU-123")
    p.add_argument("--user", default=os.getenv("JIRA_USER") or os.getenv("JIRA_EMAIL"), help="логин/емейл Jira")
    p.add_argument("--token", default=os.getenv("JIRA_TOKEN") or os.getenv("JIRA_API_TOKEN"), help="API token / пароль")
    p.add_argument("--dry-run", action="store_true", help="только скачать и показать sha, без загрузки в Jira")
    p.add_argument("--insecure", action="store_true", help="отключить проверку TLS (только если Jira с нестандартным сертификатом)")
    a = p.parse_args()

    sha = github_latest_sha(a.repo, a.ref, insecure=a.insecure)
    gh_h = {"User-Agent": UA}
    payload = []
    for path in a.files:
        raw_url = f"https://raw.githubusercontent.com/{a.repo}/{sha}/{path}"
        payload.append((Path(path).name, get_bytes(raw_url, headers=gh_h, insecure=a.insecure)))

    print(f"GitHub: {a.repo}@{sha}")
    for name, content in payload:
        print(f"- {name}: {len(content)} bytes")
    if a.dry_run:
        return 0

    missing = [k for k in ("--jira", "--issue", "--user", "--token") if getattr(a, k[2:]) in (None, "")]
    if missing:
        raise SystemExit(f"Не хватает параметров: {', '.join(missing)} (или задай через env).")

    res = jira_attach(a.jira, a.issue, a.user, a.token, payload, insecure=a.insecure)
    print(f"Jira: прикреплено к {a.issue}")
    for att in (res or []):
        fn = att.get("filename") or "?"
        url = att.get("content") or att.get("self") or "?"
        print(f"- {fn}: {url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

