"""PyInstaller entrypoint: start the ContextGit API server."""

import sys

if __name__ == "__main__":
    if '--mcp' in sys.argv:
        sys.argv.remove('--mcp')
        from contextgit.mcp.main import main
    else:
        from contextgit.api.server import main
    main()
