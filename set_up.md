   ================================================================
   BUG PUB — Set up
   ================================================================

   HOW TO SET UP SUPABASE (free, no server needed)
   ─────────────────────────────────────────────────
   1. Go to https://supabase.com → create a free account & project.
   2. In your project: Settings → API
      Copy "Project URL" and "anon public" key.
   3. Paste them into the two constants below (SUPABASE_URL / ANON).
   4. In the SQL Editor, run the schema in the README / comments below.
   5. Database → Replication → enable Realtime for `players` & `messages`.
   6. Push to GitHub Pages — done! 

   SQL to run in Supabase SQL Editor:
   
   CREATE TABLE IF NOT EXISTS players (
     id         TEXT PRIMARY KEY,
     nickname   TEXT NOT NULL,
     emoji      TEXT NOT NULL,
     x          FLOAT NOT NULL DEFAULT 50,
     y          FLOAT NOT NULL DEFAULT 50,
     updated_at TIMESTAMPTZ DEFAULT now()
   );

   CREATE TABLE IF NOT EXISTS messages (
     id         BIGSERIAL PRIMARY KEY,
     player_id  TEXT NOT NULL,
     nickname   TEXT NOT NULL,
     emoji      TEXT NOT NULL,
     content    TEXT NOT NULL,
     created_at TIMESTAMPTZ DEFAULT now()
   );

   ALTER TABLE players  ENABLE ROW LEVEL SECURITY;
   ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "allow all on players"  ON players  FOR ALL USING (true) WITH CHECK (true);
   CREATE POLICY "allow all on messages" ON messages FOR ALL USING (true) WITH CHECK (true);