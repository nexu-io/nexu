## Vendored 7-Zip extractor

- Binaries:
  - `win-x64/7z.exe`
  - `win-x64/7z.dll`
- Upstream: 7-Zip 26.00 x64
- Canonical source package: `https://github.com/ip7z/7zip/releases/download/26.00/7z2600-x64.exe`
- Reproducible extraction source: `https://github.com/ip7z/7zip/releases/download/26.00/7z2600-x64.msi`
- Upstream download page: `https://www.7-zip.org/download.html`
- License: `win-x64/License.txt`
- SHA256 (`7z.exe`): `4A41AA37786C7EAE7451E81C2C97458D5D1AE5A3A8154637A0D5F77ADC05E619`
- SHA256 (`7z.dll`): `BBD705E3B58CA7677C1E9E67473F166A6712DA034DCB567D571FBB67507A443F`
- SHA256 (`License.txt`): `519AC0A4BDED9C18EA02E0AFB71F663D8C47373BD9FACD3AC96A79F51D77765D`

These binaries are vendored only for the Windows installer build at
`apps/desktop/scripts/dist-win.mjs`.

These files remain subject to the upstream 7-Zip license and are not relicensed
under this repository's MIT license.
