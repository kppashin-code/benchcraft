import json
import os
import urllib.error
import urllib.request

TIMEOUT = 90

SUGGESTED = [
    {
        "name": "OrganoidAgent (Zitnik Lab)",
        "endpoint": "",
        "key_env": "ORGANOIDAGENT_API_KEY",
        "note": "Point this at the endpoint the lab gives you. Benchcraft POSTs "
                "{experiment, question} as JSON and stores whatever text comes back, "
                "attributed to this connector.",
    },
    {
        "name": "BioRender",
        "endpoint": "",
        "key_env": "BIORENDER_API_KEY",
        "note": "BioRender has no public figure-generation API as of this build. "
                "If your institution has an enterprise endpoint, put it here; "
                "otherwise leave this disabled and export figures by hand.",
    },
]


class ConnectorError(RuntimeError):
    pass


def _opener() -> urllib.request.OpenerDirector:
    proxy = os.environ.get("BENCHCRAFT_PROXY", "").strip()
    handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy} if proxy else {})
    return urllib.request.build_opener(handler)


def call(connector: dict, payload: dict) -> str:
    endpoint = (connector.get("endpoint") or "").strip()
    if not endpoint:
        raise ConnectorError("No endpoint set for this connector.")
    if not endpoint.startswith(("http://", "https://")):
        raise ConnectorError("Endpoint must be an http(s) URL.")

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key_env = (connector.get("key_env") or "").strip()
    if key_env:
        key = os.environ.get(key_env)
        if not key:
            raise ConnectorError(f"{key_env} is not set in this shell.")
        headers["Authorization"] = f"Bearer {key}"

    req = urllib.request.Request(
        endpoint, data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    try:
        with _opener().open(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise ConnectorError(f"{e.code} from {endpoint}: {e.read().decode(errors='replace')[:400]}")
    except Exception as e:
        raise ConnectorError(f"Could not reach {endpoint}: {e}")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip()[:20000]

    for key in ("answer", "output", "result", "text", "response", "content"):
        if isinstance(parsed.get(key), str):
            return parsed[key].strip()[:20000]
    return json.dumps(parsed, indent=2)[:20000]
