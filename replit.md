# DAYTONE

DAYTONE is a static music diary. The app lives in `daytone/` and does not need a build step, a backend, or any secrets.

## Run on Replit

Click **Run** to start the **Run DAYTONE** workflow and open **Preview**. To run it from the Shell instead, use this command from the project root:

```sh
python3 -m http.server 5000 --bind 0.0.0.0 --directory daytone
```

The server exposes only the `daytone/` directory. Diary entries are saved in the current browser's IndexedDB storage and do not sync across browsers or devices. YouTube embeds and Google Fonts use external services.
