# Scientific Word / WorkPlace 5.5 support

`tcilatex.tex` is the unmodified MacKichan support macro file dated 6 October 2005, for documents saved with the Scientific Word / Scientific WorkPlace 5.5 LaTeX filter. Its original header states that the file is not proprietary and may be freely copied and distributed. Preserve that copyright and redistribution notice.

It remains under that original notice; the project's MIT license does not relicense this third-party file. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

This repository includes the support macros only; the file contains no manuscript text. The application build copies this folder to `dist/tex-support`.

The compiler supplies the macros inside an isolated build snapshot when the paper does not provide a root-level `tcilatex.tex` of its own. A paper-local copy takes precedence, including case variants. The fallback's identity is included in build-freshness validation.

These macros do not convert Scientific Word graphics specials, BMP images, Windows paths, or arbitrary legacy build setups. Those resources may require changes in a separate paper working copy.
