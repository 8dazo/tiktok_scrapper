# tiktok-api-unofficial

[![PyPI version](https://img.shields.io/pypi/v/tiktok-api-unofficial.svg)](https://pypi.org/project/tiktok-api-unofficial/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/pypi/pyversions/tiktok-api-unofficial.svg)](https://pypi.org/project/tiktok-api-unofficial/)

Unofficial TikTok API library: scrape video and user profile metadata, and optionally download videos, slides, and audio. No official API key required.

**Repo:** [github.com/8dazo/tiktok-api-unofficial](https://github.com/8dazo/tiktok-api-unofficial)

## Install

```bash
pip install tiktok-api-unofficial
```

Or install from source:

```bash
pip install -e .
```

Or install dependencies only:

```bash
pip install requests beautifulsoup4 browser_cookie3
```

Then use the single module `tiktok_api.py` from this directory (e.g. add the directory to `PYTHONPATH` or copy the file).

## Usage

```python
from tiktok_api import TT_Content_Scraper

scraper = TT_Content_Scraper(
    wait_time=0.35,
    output_files_fp="data/",
    progress_file_fn="progress_tracking/scraping_progress.db",
    clear_console=False,
)

# Add video IDs (from TikTok URL) and/or usernames
scraper.add_objects(ids=["7398323154424171806"], title="batch1", type="content")
scraper.add_objects(ids=["tagesschau", "tiktok"], title="users", type="user")

# Scrape: metadata only, or with media (mp4/jpeg/mp3)
scraper.scrape_pending(scrape_files=False)   # metadata only
# scraper.scrape_pending(scrape_files=True)  # also download videos/slides/audio
```

- **Content:** use `type="content"` and video IDs from the video URL.
- **Users:** use `type="user"` and usernames (with or without `@`).

Output is written under `output_files_fp`:

- `content_metadata/<video_id>.json` – video/post metadata
- `user_metadata/<username>.json` – user profile metadata
- `content_files/` – mp4, jpeg, mp3 when `scrape_files=True`

Progress is stored in the SQLite database at `progress_file_fn` (pending/completed/error per ID).

## Run as script

```bash
python tiktok_api.py
```

Runs a one-off example: one video ID, metadata only, output in `data/`.
