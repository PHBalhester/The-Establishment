CREATE TABLE "candles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "candles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pool" varchar(64) NOT NULL,
	"resolution" varchar(4) NOT NULL,
	"open_time" timestamp NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" bigint NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carnage_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "carnage_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"epoch_number" integer NOT NULL,
	"tx_signature" varchar(128) NOT NULL,
	"crime_burned" bigint NOT NULL,
	"fraud_burned" bigint NOT NULL,
	"sol_used_for_buy" bigint NOT NULL,
	"crime_bought" bigint,
	"fraud_bought" bigint,
	"carnage_sol_before" bigint,
	"carnage_sol_after" bigint,
	"path" varchar(32),
	"target_token" varchar(8),
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epoch_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "epoch_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"epoch_number" integer NOT NULL,
	"tx_signature" varchar(128) NOT NULL,
	"cheap_side" varchar(8) NOT NULL,
	"crime_buy_tax" integer NOT NULL,
	"crime_sell_tax" integer NOT NULL,
	"fraud_buy_tax" integer NOT NULL,
	"fraud_sell_tax" integer NOT NULL,
	"staking_reward_deposited" bigint,
	"carnage_fund_balance" bigint,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_events" (
	"tx_signature" varchar(128) PRIMARY KEY NOT NULL,
	"pool" varchar(64) NOT NULL,
	"direction" varchar(4) NOT NULL,
	"sol_amount" bigint NOT NULL,
	"token_amount" bigint NOT NULL,
	"price" real NOT NULL,
	"tax_amount" bigint NOT NULL,
	"lp_fee" bigint NOT NULL,
	"slippage" real,
	"user_wallet" varchar(64) NOT NULL,
	"epoch_number" integer NOT NULL,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "candle_unique_idx" ON "candles" USING btree ("pool","resolution","open_time");--> statement-breakpoint
CREATE INDEX "candle_pool_res_idx" ON "candles" USING btree ("pool","resolution");--> statement-breakpoint
CREATE INDEX "candle_time_idx" ON "candles" USING btree ("open_time");--> statement-breakpoint
CREATE UNIQUE INDEX "carnage_epoch_idx" ON "carnage_events" USING btree ("epoch_number");--> statement-breakpoint
CREATE INDEX "carnage_time_idx" ON "carnage_events" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "epoch_number_idx" ON "epoch_events" USING btree ("epoch_number");--> statement-breakpoint
CREATE INDEX "epoch_time_idx" ON "epoch_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "swap_pool_idx" ON "swap_events" USING btree ("pool");--> statement-breakpoint
CREATE INDEX "swap_epoch_idx" ON "swap_events" USING btree ("epoch_number");--> statement-breakpoint
CREATE INDEX "swap_time_idx" ON "swap_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "swap_user_idx" ON "swap_events" USING btree ("user_wallet");