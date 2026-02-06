# Publish to PyPI

## 1. Create a PyPI account (if needed)

- Sign up at https://pypi.org/account/register/
- Create an API token at https://pypi.org/manage/account/token/ (scope: entire account or just this project)

## 2. Build the package (already done)

```bash
pip install build
python -m build
```

This creates `dist/tiktok_api-0.1.0.tar.gz` and `dist/tiktok_api-0.1.0-py3-none-any.whl`.

## 3. Upload to PyPI

```bash
pip install twine
twine upload dist/*
```

When prompted:
- **Username:** `__token__`
- **Password:** your PyPI API token (starts with `pypi-`)

Or use env vars (no prompt):

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=pypi-YOUR_TOKEN_HERE
twine upload dist/*
```

## 4. Test install

After upload, anyone can install with:

```bash
pip install tiktok-api-unofficial
```

Then: `from tiktok_api import TT_Content_Scraper`

## Note on package name

- PyPI project name: **tiktok-api-unofficial** (with hyphen)
- Import name: **tiktok_api** (with underscore): `from tiktok_api import ...`
