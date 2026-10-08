import json
import sys
from core import handle


def main():
    try:
        request = json.loads(sys.stdin.read(4097))
        result = handle(request)
    except (ValueError, TypeError, KeyError, ZeroDivisionError):
        result = {"error": "invalid_request"}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
