import os

import uvicorn

uvicorn.run(
    "phases_api.app:create_app",
    factory=True,
    host=os.environ.get("HOST", "127.0.0.1"),
    port=int(os.environ.get("PORT", "8000")),
)
