CREATE TABLE "checkpoint_blobs" (
	"thread_id" text NOT NULL,
	"checkpoint_ns" text DEFAULT '' NOT NULL,
	"channel" text NOT NULL,
	"version" text NOT NULL,
	"type" text NOT NULL,
	"blob" "bytea",
	CONSTRAINT "checkpoint_blobs_pkey" PRIMARY KEY("thread_id","checkpoint_ns","channel","version")
);
--> statement-breakpoint
CREATE TABLE "checkpoint_migrations" (
	"v" integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO "checkpoint_migrations" ("v") VALUES (0), (1), (2), (3), (4);--> statement-breakpoint
CREATE TABLE "checkpoint_writes" (
	"thread_id" text NOT NULL,
	"checkpoint_ns" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"task_id" text NOT NULL,
	"idx" integer NOT NULL,
	"channel" text NOT NULL,
	"type" text,
	"blob" "bytea" NOT NULL,
	CONSTRAINT "checkpoint_writes_pkey" PRIMARY KEY("thread_id","checkpoint_ns","checkpoint_id","task_id","idx")
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"thread_id" text NOT NULL,
	"checkpoint_ns" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"parent_checkpoint_id" text,
	"type" text,
	"checkpoint" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "checkpoints_pkey" PRIMARY KEY("thread_id","checkpoint_ns","checkpoint_id")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_checkpoint_thread_id_key" UNIQUE("checkpoint_thread_id");--> statement-breakpoint
ALTER TABLE "checkpoint_blobs" ADD CONSTRAINT "checkpoint_blobs_thread_id_agent_runs_checkpoint_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_runs"("checkpoint_thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint_writes" ADD CONSTRAINT "checkpoint_writes_thread_id_agent_runs_checkpoint_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_runs"("checkpoint_thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_thread_id_agent_runs_checkpoint_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_runs"("checkpoint_thread_id") ON DELETE cascade ON UPDATE no action;
