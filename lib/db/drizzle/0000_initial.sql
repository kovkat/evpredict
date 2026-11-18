CREATE TYPE "public"."planner_kind" AS ENUM('evpredict', 'baseline');--> statement-breakpoint
CREATE TYPE "public"."trip_source" AS ENUM('manual', 'csv', 'simulator', 'dataset', 'bluetooth-obd');--> statement-breakpoint
CREATE TABLE "personal_models" (
	"vehicle_id" integer PRIMARY KEY NOT NULL,
	"k" real NOT NULL,
	"k_city" real NOT NULL,
	"k_suburban" real NOT NULL,
	"k_highway" real NOT NULL,
	"sigma" real NOT NULL,
	"trips" integer NOT NULL,
	"reliable_trips" integer NOT NULL,
	"mape_model_pct" real,
	"mape_personal_pct" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"planner" "planner_kind" NOT NULL,
	"from_city" text NOT NULL,
	"to_city" text NOT NULL,
	"soc_start_pct" real NOT NULL,
	"reserve_pct" real NOT NULL,
	"temp_c" real NOT NULL,
	"sigma" real NOT NULL,
	"corridor_km" integer NOT NULL,
	"km" real NOT NULL,
	"total_minutes" real NOT NULL,
	"charge_minutes" real NOT NULL,
	"min_soc_pct" real NOT NULL,
	"arrive_soc_pct" real NOT NULL,
	"risky" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"station_id" integer,
	"title" text NOT NULL,
	"town" text,
	"km_from_start" real NOT NULL,
	"soc_arrive_pct" real NOT NULL,
	"charge_to_pct" real,
	"charge_minutes" real
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"ocm_id" integer NOT NULL,
	"title" text NOT NULL,
	"town" text,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"max_kw" real NOT NULL,
	"dc" boolean NOT NULL,
	"connectors" text[] NOT NULL,
	"points" integer NOT NULL,
	"status_type_id" integer,
	"last_verified" timestamp with time zone,
	"checkins_ok" integer DEFAULT 0 NOT NULL,
	"checkins_failed" integer DEFAULT 0 NOT NULL,
	"reliability_index" real NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"parts" jsonb NOT NULL,
	"temp_c" real NOT NULL,
	"elev_gain_m" real DEFAULT 0 NOT NULL,
	"elev_loss_m" real DEFAULT 0 NOT NULL,
	"soc_start_pct" real NOT NULL,
	"soc_end_pct" real NOT NULL,
	"actual_kwh" real NOT NULL,
	"source" "trip_source" NOT NULL,
	"simulated_profile" text,
	"used_for_learning" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"model_id" text NOT NULL,
	"soh_pct" real NOT NULL,
	"label" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_models" ADD CONSTRAINT "personal_models_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_plan_id_route_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."route_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_plans_vehicle_idx" ON "route_plans" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "route_stops_plan_seq_uq" ON "route_stops" USING btree ("plan_id","seq");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_ocm_uq" ON "stations" USING btree ("ocm_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "stations_geo_idx" ON "stations" USING btree ("lat","lon");--> statement-breakpoint
CREATE INDEX "trips_vehicle_time_idx" ON "trips" USING btree ("vehicle_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_vehicle_client_uq" ON "trips" USING btree ("vehicle_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_user_model_uq" ON "vehicles" USING btree ("user_id","model_id");