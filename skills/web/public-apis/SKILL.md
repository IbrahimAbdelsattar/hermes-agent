---
name: public-apis
description: "Discover, explore, and integrate free public APIs from the curated public-apis catalog (1,890+ APIs across 52 categories)."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [APIs, Public APIs, Free APIs, Integration, Web Services, Development]
    related_skills: [web]
---

# Public APIs Discovery & Integration

Use this skill when you need to find public endpoints, free web services, or developer APIs to answer user requests, build tools, fetch live data, or write client integrations.

The catalog indexes **1,890+ public APIs across 52 categories** maintained upstream at [public-apis/public-apis](https://github.com/public-apis/public-apis.git).

---

## When to Use

1. The user asks: *"Is there a free API for X?"* (weather, currency conversion, crypto, cat facts, sports scores, translation, geocoding, quotes, ISS tracking, GitHub data, etc.).
2. You need to build a code example or feature that requires a real working API without requiring complex paid credentials.
3. You need to verify authentication requirements (None / Free vs. API Key vs. OAuth) or HTTPS/CORS support before recommending an API.

---

## How to Access

### 1. Via Agent Tool (`public_apis_search`)
Hermes has direct native tool access:

```json
{
  "query": "weather",
  "category": "Weather",
  "auth": "free",
  "limit": 5
}
```

### 2. Common Categories
- **Animals**: Cat Facts, Dog API, HTTP Cat, HTTP Dog, FishWatch
- **Cryptocurrency**: CoinGecko, Binance, CoinCap, CryptoCompare
- **Currency Exchange**: ExchangeRate-API, Frankfurter, Fixer
- **Development**: GitHub, GitLab, Docker Hub, StackExchange
- **Geocoding**: Nominatim OpenStreetMap, IPinfo, Zippopotam
- **Machine Learning**: Hugging Face Hub, OpenAI, Replicate
- **Music**: Spotify, MusicBrainz, Last.fm, Genius
- **News**: NewsAPI, Currents, Spaceflight News
- **Science & Math**: NASA Open APIs, Where The ISS At, Open Notify
- **Security**: HaveIBeenPwned, Shodan, URLScan, VirusTotal
- **Test Data**: JSONPlaceholder, ReqRes, DummyJSON, RandomUser
- **Weather**: Open-Meteo (free, no key), OpenWeatherMap, WeatherAPI

### 3. CLI Command
You can also run or instruct the user to run:
```bash
hermes public-apis search "weather" --auth free
hermes public-apis list --category "Animals"
hermes public-apis sync
```
