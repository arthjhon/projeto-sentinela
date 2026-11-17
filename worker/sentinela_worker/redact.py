import re

MAX_ERROR_LEN = 500
_KEYS = r"(?:key|apikey|api_key|token|access_token|password|pass|secret|auth)"
_QUERY = re.compile(rf"(?i)([?&;]{_KEYS}=)[^&\s'\"<>]*")
_USERINFO = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s@'\"]+@")
_AUTH_HEADER = re.compile(r"(?i)\b(authorization\s*[:=]\s*)[^\r\n'\"]*")
_SCHEME_TOKEN = re.compile(r"(?i)\b(bearer|token|basic)\s+[A-Za-z0-9._~+/=-]+")


def redact_text(text: str) -> str:
    text = _USERINFO.sub(r"\1***@", text)
    text = _QUERY.sub(r"\1***", text)
    text = _AUTH_HEADER.sub(r"\1***", text)
    text = _SCHEME_TOKEN.sub(r"\1 ***", text)
    return text


def redact_error(exc: BaseException) -> str:
    text = redact_text(f"{type(exc).__name__}: {exc}")
    return text if len(text) <= MAX_ERROR_LEN else text[: MAX_ERROR_LEN - 3] + "..."
