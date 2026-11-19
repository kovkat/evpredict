CREATE TABLE "own_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"max_kw" real NOT NULL,
	"dc" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "own_stations" ADD CONSTRAINT "own_stations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "own_stations_user_idx" ON "own_stations" USING btree ("user_id");