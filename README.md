# Dividend Hunter

![Dividend Hunter Screenshot](Screenshot%202026.png)

Simple web app for screening dividend stocks. Pulls data from Yahoo Finance via yfinance and refreshes hourly. Shows key metrics for each stock and lets you save the ones you like or pass on others. Build a portfolio, filter by minimum yield or safety score, track average yield, and export to CSV.

Live site: https://dividend-hunter.up.railway.app

This project was created with Google Anti gravity.

## Features

- Displays stocks with:
  - Company name and ticker
  - Sector
  - Dividend yield
  - Annual dividend
  - 5-year dividend growth rate
  - Consecutive years of dividend increases
  - Payout ratio
  - Current price
  - Payment frequency
  - Safety score (out of 100)

- Save or pass individual stocks
- Filters for minimum yield and minimum safety score
- Portfolio view with saved stocks count and average yield
- Export saved stocks to CSV
- Clear swipe history or portfolio
- Auto-refresh data hourly
- Works offline with cached data

## Tech Stack

- Python (Flask backend)
- yfinance for data
- HTML/CSS/JavaScript frontend
- Deployed on Railway

