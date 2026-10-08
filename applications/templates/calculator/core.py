import math


def handle(request):
    if not isinstance(request, dict):
        return {"error": "invalid_request"}
    op, a, b = request.get("op"), request.get("a"), request.get("b")
    if type(a) not in (int, float) or type(b) not in (int, float):
        return {"error": "invalid_request"}
    if not math.isfinite(a) or not math.isfinite(b):
        return {"error": "invalid_request"}
    if op not in ("add", "subtract", "multiply", "divide"):
        return {"error": "invalid_request"}
    if op == "divide" and b == 0:
        return {"error": "division_by_zero"}
    result = {"add": lambda: a + b, "subtract": lambda: a - b,
              "multiply": lambda: a * b, "divide": lambda: a / b}[op]()
    if not math.isfinite(result):
        return {"error": "invalid_request"}
    return {"result": result}
