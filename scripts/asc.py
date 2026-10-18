#!/usr/bin/env python3
"""
Ask App Store Connect what it has.

Built because checking whether a build had finished processing meant asking
somebody to go and look. The key itself never passes through here: it is read
from disk at the moment it is needed, used to sign a token that lasts twenty
minutes, and never printed.

Set up once:
  ~/.appstoreconnect/config.json          {"keyId": "...", "issuerId": "..."}
  ~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8

Usage:
  python3 scripts/asc.py builds           recent builds and their state
  python3 scripts/asc.py versions         app store versions and theirs
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

HOME = Path.home() / ".appstoreconnect"
CONFIG = HOME / "config.json"
BUNDLE_ID = "com.apexiavip.app"


def die(message: str, how: str = "") -> None:
    print(message)
    if how:
        print(how)
    sys.exit(1)


def token() -> str:
    if not CONFIG.exists():
        die(
            f"Not set up yet: {CONFIG} is missing.",
            'It needs {"keyId": "ABCD123456", "issuerId": "<uuid from App Store Connect>"}',
        )
    cfg = json.loads(CONFIG.read_text())
    key_id, issuer = cfg.get("keyId"), cfg.get("issuerId")
    if not key_id or not issuer:
        die(f"{CONFIG} needs both keyId and issuerId.")
    key_file = HOME / "private_keys" / f"AuthKey_{key_id}.p8"
    if not key_file.exists():
        die(f"The private key is missing: {key_file}", "Apple only lets it be downloaded once.")
    try:
        import jwt
    except ImportError:
        die("PyJWT is not installed.", "pip3 install pyjwt cryptography")
    now = int(time.time())
    return jwt.encode(
        {"iss": issuer, "iat": now, "exp": now + 20 * 60, "aud": "appstoreconnect-v1"},
        key_file.read_text(),
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


def get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.appstoreconnect.apple.com/v1/{path}",
        headers={"Authorization": f"Bearer {token()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400]
        die(f"App Store Connect said {e.code}.", body)


def app_id() -> str:
    data = get(f"apps?filter[bundleId]={BUNDLE_ID}")
    if not data.get("data"):
        die(f"No app found for {BUNDLE_ID}.", "Does the key have access to this app?")
    return data["data"][0]["id"]


def builds() -> None:
    data = get(f"builds?filter[app]={app_id()}&limit=10&sort=-uploadedDate")
    rows = data.get("data", [])
    if not rows:
        print("No builds at all.")
        return
    print(f"{'version':<10} {'build':<8} {'state':<28} uploaded")
    for b in rows:
        a = b["attributes"]
        print(
            f"{str(a.get('preReleaseVersion') or '?'):<10} "
            f"{str(a.get('version')):<8} "
            f"{str(a.get('processingState')):<28} "
            f"{str(a.get('uploadedDate'))[:19].replace('T', ' ')}"
        )


def versions() -> None:
    data = get(f"apps/{app_id()}/appStoreVersions?limit=10")
    for v in data.get("data", []):
        a = v["attributes"]
        print(f"{a.get('versionString'):<10} {a.get('appStoreState')}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "builds"
    {"builds": builds, "versions": versions}.get(what, builds)()
