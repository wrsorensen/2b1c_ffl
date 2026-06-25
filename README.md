# 2B1C FFL — GitHub Frontend v0.3.0-alpha

Purpose:
Static GitHub Pages mobile shell prototype.

This is NOT wired to Google Sheets yet.

## Structure

- GitHub Pages = frontend/mobile app shell
- Apps Script = backend API later
- Google Sheet = source of truth

## Test password

2B1C2026

## Current goal

Confirm the mobile layout finally feels right on a phone without the Google Apps Script web-app wrapper.

## Later wiring

Replace mock login/posts in `app.js` with calls to Apps Script API endpoints:

- checkPassword
- getAppData
- verifyManagerPin
- submitTrashTalk

## Suggested GitHub Pages setup

Create repo:
2b1c-ffl-app

Upload these files to root:
- index.html
- styles.css
- app.js
- manifest.json
- assets/icon-192.svg
- assets/icon-512.svg

Enable:
Settings > Pages > Deploy from branch > main > /root
