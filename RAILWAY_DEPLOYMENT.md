# 🚀 Railway Deployment Guide - Dividend Hunter

## ✅ FIXES APPLIED

### Critical Code Fixes
1. **HTML Structure** - Fixed nested `header-actions` div and filter bar placement
2. **Dividend Yield Calculation** - Corrected percentage handling (yfinance returns decimal, we convert to %)
3. **Category Cleanup** - Removed deprecated `longshot` and `balanced` categories
4. **Data Directory** - Added explicit creation with logging for Railway

### Railway Deployment Fixes
5. **Startup Script** - Created `start.sh` to ensure data directory exists
6. **Config Updates** - Updated `railway.toml` and `nixpacks.toml` to use startup script
7. **Logging** - Added cache status logging on startup

---

## 🔍 ROOT CAUSE: Why Data Wasn't Showing on Railway

### The Problem
Your data files (`data/latest_snapshot.json` and `data/historical_dividends.json`) are tracked in git and deployed to Railway, BUT:

1. **Directory Creation Timing** - The `data/` directory might not exist when Python tries to read from it
2. **File Path Issues** - Railway's working directory might differ from local
3. **No Startup Logging** - You couldn't see if files were actually there

### The Solution
- ✅ **Startup Script** (`start.sh`) - Creates data directory before app starts
- ✅ **Explicit Directory Creation** - `main.py` now creates directory with `parents=True`
- ✅ **Startup Logging** - Shows cache status in Railway logs
- ✅ **Proper Permissions** - `chmod +x start.sh` in nixpacks config

---

## 📋 DEPLOYMENT CHECKLIST

### Before Pushing to GitHub:

1. **Verify Data Files Are Committed**
   ```bash
   git status
   # Should show data/ files as committed, not ignored
   ```

2. **Check File Sizes**
   ```bash
   ls -lh data/
   # latest_snapshot.json should be ~2MB
   # historical_dividends.json should be ~400KB
   ```

3. **Commit All Changes**
   ```bash
   git add .
   git commit -m "Fix: HTML structure, dividend yield calc, Railway deployment"
   git push origin main
   ```

### On Railway:

4. **Check Deployment Logs**
   Look for these messages:
   ```
   🚀 Starting Dividend Hunter on Railway...
   ✅ Found cached data (1.9M)
   🌐 Starting uvicorn on port 8000...
   Data directory: /app/data
   ✅ Found cached snapshot: 1.87 MB
   ```

5. **Test the Health Endpoint**
   ```
   https://your-app.railway.app/health
   ```
   Should return: `{"status": "ok", "service": "Dividend Hunter API"}`

6. **Test the Stocks Endpoint**
   ```
   https://your-app.railway.app/api/stocks
   ```
   Should return stocks immediately (from cache)

---

## 🐛 TROUBLESHOOTING

### If Data Still Doesn't Show:

#### Check 1: Verify Files Are in Deployment
In Railway logs, look for:
```
✅ Found cached data (1.9M)
```

If you see:
```
⚠️  No cached data found
```

Then files aren't in the deployment. Check:
```bash
# On your local machine
git ls-files data/
# Should show:
# data/historical_dividends.json
# data/latest_snapshot.json
```

#### Check 2: Verify Directory Permissions
Railway logs should show:
```
Data directory: /app/data
```

If you see permission errors, the startup script should fix it.

#### Check 3: Check API Response
Visit: `https://your-app.railway.app/api/stocks`

**If you see:**
```json
{
  "stocks": [],
  "status": "needs_initialization"
}
```
**Then:** Cache isn't loading. Check Railway logs for errors.

**If you see:**
```json
{
  "stocks": [...],
  "total": 200+,
  "fetchedAt": "2026-01-31T..."
}
```
**Then:** ✅ SUCCESS! Data is loading.

---

## 🔧 MANUAL FIX (If Needed)

If data still doesn't load, you can force a refresh:

1. **Via Frontend**
   - Open your app
   - Click the "Refresh" button in header
   - Wait 2-3 minutes for data to fetch

2. **Via API**
   ```
   https://your-app.railway.app/api/stocks?force_refresh=true
   ```

3. **Via Railway Console**
   - Go to Railway dashboard
   - Open your app's shell
   - Run:
     ```bash
     python seed_cache.py
     ```

---

## 📊 EXPECTED BEHAVIOR

### First Load (with cache):
1. User opens app
2. Frontend calls `/api/stocks`
3. Backend loads from `data/latest_snapshot.json`
4. Cards appear **instantly** (< 1 second)
5. If data is > 7 days old, "Update" button appears

### First Load (without cache):
1. User opens app
2. Frontend calls `/api/stocks`
3. Backend returns `status: "needs_initialization"`
4. User clicks "Initialize" or "Refresh"
5. Backend fetches from yfinance (2-3 minutes)
6. Data is cached to `data/latest_snapshot.json`
7. Cards appear

---

## 🎯 VERIFICATION STEPS

After deploying to Railway:

1. ✅ **Check Logs** - Look for "Found cached snapshot"
2. ✅ **Test Health** - `/health` returns 200 OK
3. ✅ **Test API** - `/api/stocks` returns data immediately
4. ✅ **Test Frontend** - Cards load without "Initialize" prompt
5. ✅ **Check Console** - No errors in browser console

---

## 📝 FILES CHANGED

### Fixed Files:
- `static/index.html` - HTML structure fixes
- `static/js/cards.js` - Removed deprecated categories
- `main.py` - Dividend yield calculation + directory creation + logging

### New Files:
- `start.sh` - Railway startup script

### Updated Configs:
- `railway.toml` - Use startup script
- `nixpacks.toml` - Use startup script + set permissions

---

## 🚨 IMPORTANT NOTES

1. **Data Files Must Be Committed**
   - The `.gitignore` already allows `data/` files (line 37 is commented)
   - Verify with: `git ls-files data/`

2. **Railway Uses Ephemeral Filesystem**
   - Any data written at runtime will be lost on restart
   - That's why we commit the cache files to git

3. **Cache Refresh Strategy**
   - Users can manually refresh via button
   - Auto-refresh can be enabled in settings
   - Backend won't auto-refresh on startup (would timeout)

4. **Port Configuration**
   - Railway sets `PORT` environment variable
   - Our startup script uses `${PORT:-8000}` (defaults to 8000)
   - Never hardcode port 8008 (per your rules)

---

## ✨ SUMMARY

**What was broken:**
- Nested HTML divs
- Dividend yield percentage confusion
- Data directory not guaranteed to exist on Railway
- No logging to debug deployment issues

**What's fixed:**
- ✅ Clean HTML structure
- ✅ Correct percentage calculations
- ✅ Guaranteed data directory creation
- ✅ Startup logging for debugging
- ✅ Proper Railway configuration

**Next steps:**
1. Commit and push changes
2. Deploy to Railway
3. Check logs for "✅ Found cached snapshot"
4. Test the app - cards should load instantly!

---

**Questions?** Check the troubleshooting section above or review Railway logs.
