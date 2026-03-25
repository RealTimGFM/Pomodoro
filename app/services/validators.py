from dataclasses import dataclass


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    value: str = ""
    message: str | None = None


def validate_search_query(raw_value: str, *, minimum: int = 2, maximum: int = 100) -> ValidationResult:
    value = (raw_value or "").strip()
    if not value:
        return ValidationResult(False, message="Enter a search term to find YouTube videos or playlists.")
    if len(value) < minimum:
        return ValidationResult(False, message=f"Search must be at least {minimum} characters.")
    if len(value) > maximum:
        return ValidationResult(False, message=f"Search must be {maximum} characters or fewer.")
    return ValidationResult(True, value=value)


def clamp_requested_results(raw_value: str | None, *, default: int = 8, minimum: int = 1, maximum: int = 12) -> int:
    try:
        value = int(raw_value) if raw_value is not None else default
    except (TypeError, ValueError):
        return default
    return max(minimum, min(value, maximum))
