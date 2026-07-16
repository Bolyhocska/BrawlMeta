# BrawlMeta scrapers package.
#
# Each data source has its own independently runnable module so a failure or
# slowdown in one can never block the others (they used to share one
# monolithic scraper.py):
#
#   python -m scrapers.leaderboard      → SiteFeed relays + top_200_leaderboard
#   python -m scrapers.masters          → Masters+ ranked matches (brawlace seeds)
#   python -m scrapers.diamond_mythic   → Diamond/Mythic ranked matches
#
# Shared plumbing (config, Supercell/Supabase clients, spider, normalized
# insert pipeline) lives in scrapers/common.py.
