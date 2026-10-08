def handle(request):
    if not isinstance(request, dict):
        return {"error": "invalid_request"}
    name = request.get("name", "World")
    if not isinstance(name, str) or len(name) > 80:
        return {"error": "invalid_request"}
    return {"message": "Hello, " + (name.strip() or "World") + "!"}
