Electron App Icons
==================

Generated icons for your Electron application.

Directory Structure:
--------------------
/
├── icon.png          # Original source image
├── windows/
│   ├── icon.ico      # Windows icon file (contains multiple sizes)
│   └── *.png         # Individual PNG files
├── macos/
│   ├── icon.icns     # macOS icon file (contains multiple sizes)
│   └── *.png         # Individual PNG files
└── linux/
    └── icons/
        └── *.png     # PNG files for Linux

Usage in Electron:
------------------
In your main process file:

const path = require('path');

// Windows
if (process.platform === 'win32') {
  mainWindow.setIcon(path.join(__dirname, 'assets/windows/icon.ico'));
}

// Linux
if (process.platform === 'linux') {
  mainWindow.setIcon(path.join(__dirname, 'assets/linux/icons/512x512.png'));
}

// macOS - set in package.json or electron-builder config
// "mac": {
//   "icon": "assets/macos/icon.icns"
// }

Generated with WebUtils - https://webutils.app