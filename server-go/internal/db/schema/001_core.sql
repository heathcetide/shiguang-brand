-- Go-owned application schema. SQLite is canonical; PostgreSQL DDL is derived by schemaSQL.
-- No user records, credentials or demo data belong in migrations.

CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			email TEXT UNIQUE,
			phone TEXT UNIQUE,
			password_hash TEXT,
			nickname TEXT,
			avatar_url TEXT,
			bio TEXT,
			role TEXT DEFAULT 'user',
			must_change_password INTEGER DEFAULT 0,
			session_version INTEGER NOT NULL DEFAULT 1,
			daily_calories_target INTEGER,
			is_disabled INTEGER DEFAULT 0,
			is_verified_expert INTEGER DEFAULT 0,
			last_login_at TEXT,
			last_login_ip TEXT,
			phone_verified_at TEXT,
			email_verified_at TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS inventory_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			food_name TEXT NOT NULL,
			category TEXT NOT NULL,
			quantity TEXT NOT NULL,
			expiration_date TEXT NOT NULL,
			storage_location TEXT DEFAULT '冷藏',
			image_url TEXT,
			is_available INTEGER DEFAULT 1,
			version INTEGER DEFAULT 1,
			quantity_value TEXT,
			quantity_unit TEXT,
			note TEXT,
			deleted_at TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS system_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);

CREATE TABLE IF NOT EXISTS recipes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			summary TEXT,
			cover_image_url TEXT,
			cook_time_minutes INTEGER,
			difficulty TEXT,
			ingredients_json TEXT,
			steps_json TEXT
		);

CREATE TABLE IF NOT EXISTS funnel_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_name TEXT NOT NULL,
			actor_hash TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			admin_user_id INTEGER,
			action TEXT,
			resource_type TEXT,
			resource_id TEXT,
			summary TEXT,
			ip_address TEXT,
			user_agent TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS user_health_profiles (
			user_id INTEGER PRIMARY KEY,
			profile_json TEXT
		);

CREATE TABLE IF NOT EXISTS inventory_change_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			inventory_item_id INTEGER,
			action TEXT,
			source TEXT,
			quantity_before TEXT,
			quantity_after TEXT,
			quantity_unit TEXT,
			delta_value TEXT,
			idempotency_key TEXT,
			metadata_json TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS inventory_consumption_requests (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			idempotency_key TEXT NOT NULL,
			result_json TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, idempotency_key)
		);

CREATE TABLE IF NOT EXISTS shopping_inventory_imports (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			idempotency_key TEXT NOT NULL,
			result_json TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, idempotency_key)
		);

CREATE TABLE IF NOT EXISTS inventory_intake_batches (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			idempotency_key TEXT NOT NULL,
			source TEXT NOT NULL,
			source_reference TEXT,
			confirmed_payload_json TEXT NOT NULL,
			result_json TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, idempotency_key)
		);

CREATE TABLE IF NOT EXISTS inventory_scan_jobs (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			image_hash TEXT,
			status TEXT NOT NULL DEFAULT 'queued',
			result_json TEXT,
			error_message TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS ai_write_confirmations (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'preview',
			payload_json TEXT,
			result_json TEXT,
			idempotency_key TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS agent_runs (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			modality TEXT NOT NULL,
			status TEXT NOT NULL,
			summary_json TEXT,
			artifacts_json TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS agent_run_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			event_json TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(run_id, sequence)
		);

CREATE TABLE IF NOT EXISTS diet_records (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				meal_type TEXT,
				food_name TEXT,
				calories INTEGER DEFAULT 0,
				recorded_at TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

CREATE TABLE IF NOT EXISTS health_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				weight REAL,
				steps REAL,
				sleep_hours REAL,
				recorded_at TEXT,
				recorded_date TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

CREATE TABLE IF NOT EXISTS user_onboarding (
				user_id INTEGER PRIMARY KEY,
				payload_json TEXT,
				updated_at TEXT
			);

CREATE TABLE IF NOT EXISTS cooking_queue_items (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				recipe_id INTEGER,
				status TEXT DEFAULT 'waiting',
				position INTEGER DEFAULT 0,
				version INTEGER DEFAULT 1,
				body_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME
			);

CREATE TABLE IF NOT EXISTS meal_plans (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				title TEXT,
				status TEXT DEFAULT 'draft',
				version INTEGER DEFAULT 1,
				payload_json TEXT,
				constraints_json TEXT DEFAULT '{}',
				draft_json TEXT DEFAULT '{}',
				start_date TEXT,
				end_date TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME,
				deleted_at TEXT
			);

CREATE TABLE IF NOT EXISTS meal_plan_items (
				id TEXT PRIMARY KEY,
				plan_id TEXT NOT NULL,
				user_id INTEGER NOT NULL,
				status TEXT DEFAULT 'planned',
				version INTEGER DEFAULT 1,
				payload_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME,
				deleted_at TEXT
			);

CREATE TABLE IF NOT EXISTS meal_plan_changes (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				plan_id TEXT NOT NULL,
				item_id TEXT,
				status TEXT DEFAULT 'pending',
				fingerprint TEXT,
				body_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				applied_at TEXT
			);

CREATE TABLE IF NOT EXISTS meal_plan_execution_requests (
				user_id INTEGER NOT NULL,
				idempotency_key TEXT NOT NULL,
				action TEXT NOT NULL,
				meal_plan_item_id TEXT NOT NULL,
				result_json TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			);

CREATE TABLE IF NOT EXISTS prepared_meals (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				idempotency_key TEXT,
				food_name TEXT NOT NULL,
				produced_servings REAL DEFAULT 1,
				remaining_servings REAL DEFAULT 1,
				version INTEGER DEFAULT 1,
				result_json TEXT DEFAULT '{}',
				produced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME
			);

CREATE TABLE IF NOT EXISTS prepared_meal_events (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				prepared_meal_id TEXT NOT NULL,
				idempotency_key TEXT NOT NULL,
				event_type TEXT NOT NULL,
				result_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			);

CREATE TABLE IF NOT EXISTS cooking_completions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				idempotency_key TEXT NOT NULL,
				result_json TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			);

CREATE TABLE IF NOT EXISTS inventory_outcome_events (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				idempotency_key TEXT,
				outcome TEXT DEFAULT 'unknown',
				scope TEXT DEFAULT 'personal',
				occurred_at TEXT,
				payload_json TEXT DEFAULT '{}',
				version INTEGER DEFAULT 1,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			);

CREATE TABLE IF NOT EXISTS plan_maintenance_settings (
				user_id INTEGER PRIMARY KEY,
				enabled INTEGER DEFAULT 0,
				time_zone TEXT,
				local_time TEXT,
				next_check_at TEXT,
				next_local_date TEXT,
				last_completed_local_date TEXT,
				version INTEGER DEFAULT 0,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

CREATE TABLE IF NOT EXISTS plan_maintenance_jobs (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				status TEXT DEFAULT 'queued',
				attempts INTEGER DEFAULT 0,
				available_at TEXT,
				result_json TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME
			);

CREATE TABLE IF NOT EXISTS plan_maintenance_events (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				event_type TEXT,
				source_id TEXT,
				subject_id TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

CREATE TABLE IF NOT EXISTS households (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		invite_code TEXT UNIQUE,
		owner_id INTEGER,
		owner_user_id INTEGER,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS household_members (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		role TEXT DEFAULT 'member',
		dining_shared INTEGER NOT NULL DEFAULT 0,
		dining_preferences_json TEXT NOT NULL DEFAULT '{}',
		dining_version INTEGER NOT NULL DEFAULT 1,
		joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(household_id, user_id)
	);

CREATE TABLE IF NOT EXISTS household_inventory (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		created_by_user_id INTEGER NOT NULL,
		food_name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '其他',
		quantity TEXT NOT NULL DEFAULT '1',
		expiration_date TEXT,
		storage_location TEXT DEFAULT '冷藏',
		image_url TEXT,
		is_available INTEGER DEFAULT 1,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS household_inventory_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		created_by_user_id INTEGER NOT NULL,
		food_name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '其他',
		quantity TEXT NOT NULL DEFAULT '1',
		expiration_date TEXT,
		storage_location TEXT DEFAULT '冷藏',
		image_url TEXT,
		is_available INTEGER DEFAULT 1,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS household_meals (
		id TEXT PRIMARY KEY,
		household_id INTEGER NOT NULL,
		created_by_user_id INTEGER,
		membership_id INTEGER,
		food_name TEXT NOT NULL,
		produced_servings REAL NOT NULL DEFAULT 1,
		remaining_servings REAL NOT NULL DEFAULT 1,
		payload_json TEXT,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS household_meal_reservations (
		meal_id TEXT NOT NULL,
		membership_id INTEGER NOT NULL,
		servings REAL NOT NULL DEFAULT 0,
		PRIMARY KEY(meal_id, membership_id)
	);

CREATE TABLE IF NOT EXISTS household_shopping_items (
		id TEXT PRIMARY KEY,
		household_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		amount TEXT NOT NULL DEFAULT '适量',
		category TEXT NOT NULL DEFAULT '其他',
		checked INTEGER NOT NULL DEFAULT 0,
		storage_location TEXT,
		expiration_date TEXT,
		created_by_user_id INTEGER NOT NULL,
		updated_by_user_id INTEGER NOT NULL,
		purchased_by_user_id INTEGER,
		version INTEGER NOT NULL DEFAULT 1,
		deleted_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS household_dining_preferences (
		household_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		membership_id INTEGER,
		dining_shared INTEGER NOT NULL DEFAULT 0,
		preferences_json TEXT NOT NULL DEFAULT '{}',
		version INTEGER NOT NULL DEFAULT 1,
		PRIMARY KEY(household_id, user_id)
	);

CREATE TABLE IF NOT EXISTS household_activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		operator_user_id INTEGER NOT NULL,
		action TEXT NOT NULL,
		food_name TEXT,
		quantity TEXT,
		storage_location TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS community_posts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		content TEXT,
		share_code TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS community_comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		post_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		username TEXT,
		content TEXT NOT NULL,
		likes_count INTEGER DEFAULT 0,
		accepted INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS community_follows (
		follower_id INTEGER NOT NULL,
		followed_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(follower_id, followed_id)
	);

CREATE TABLE IF NOT EXISTS community_checkins (
		user_id INTEGER NOT NULL,
		date_key TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(user_id, date_key)
	);

CREATE TABLE IF NOT EXISTS community_shares (
		code TEXT PRIMARY KEY,
		post_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS community_comment_likes (
		comment_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(comment_id, user_id)
	);

CREATE TABLE IF NOT EXISTS community_post_likes (
		post_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(post_id, user_id)
	);

CREATE TABLE IF NOT EXISTS notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		type TEXT,
		title TEXT,
		body TEXT,
		read_at TEXT,
		is_read INTEGER DEFAULT 0,
		action_status TEXT,
		metadata_json TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS user_notification_inbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL,
		is_read INTEGER NOT NULL DEFAULT 0,
		action_status TEXT,
		feedback_id INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS user_notification_preferences (
		user_id INTEGER PRIMARY KEY,
		expiring_alert INTEGER NOT NULL DEFAULT 1,
		meal_reminder INTEGER NOT NULL DEFAULT 1,
		water_reminder INTEGER NOT NULL DEFAULT 1,
		breakfast_time TEXT DEFAULT '08:00',
		lunch_time TEXT DEFAULT '12:00',
		dinner_time TEXT DEFAULT '18:00',
		water_start_time TEXT DEFAULT '09:00',
		water_end_time TEXT DEFAULT '21:00',
		water_interval_minutes INTEGER DEFAULT 120,
		quiet_start_time TEXT DEFAULT '22:00',
		quiet_end_time TEXT DEFAULT '07:00',
		weekdays_enabled INTEGER DEFAULT 1,
		weekends_enabled INTEGER DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS user_intervention_preferences (
		user_id INTEGER PRIMARY KEY,
		preferences_json TEXT NOT NULL DEFAULT '{}',
		version INTEGER NOT NULL DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS push_devices (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		expo_push_token TEXT NOT NULL,
		platform TEXT NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(expo_push_token)
	);

CREATE TABLE IF NOT EXISTS notification_interventions (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		intervention_type TEXT,
		title TEXT,
		body TEXT,
		card_json TEXT,
		payload_json TEXT,
		feedback_json TEXT,
		status TEXT DEFAULT 'inbox',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS proactive_intervention_preferences (
		user_id INTEGER PRIMARY KEY,
		enabled INTEGER NOT NULL DEFAULT 0,
		expiry_rescue INTEGER NOT NULL DEFAULT 1,
		dinner_window INTEGER NOT NULL DEFAULT 1,
		time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
		dinner_time TEXT NOT NULL DEFAULT '18:00',
		dinner_lead_minutes INTEGER NOT NULL DEFAULT 60,
		extras_json TEXT NOT NULL DEFAULT '{}',
		version INTEGER NOT NULL DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS proactive_interventions (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		source_key TEXT NOT NULL,
		kind TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'inbox',
		title TEXT,
		body TEXT,
		why_now TEXT,
		expires_label TEXT,
		starts_at DATETIME,
		expires_at DATETIME,
		local_date TEXT,
		inventory_ids_json TEXT,
		recipe_ids_json TEXT,
		candidate_json TEXT,
		notification_id INTEGER,
		delivery_state TEXT NOT NULL DEFAULT 'none',
		channel TEXT DEFAULT 'inbox_only',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, source_key)
	);

CREATE TABLE IF NOT EXISTS proactive_intervention_scan_cursor (
		id INTEGER PRIMARY KEY CHECK(id=1),
		user_id_cursor INTEGER NOT NULL DEFAULT 0,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS proactive_intervention_actions (
		id TEXT PRIMARY KEY,
		intervention_id TEXT NOT NULL,
		user_id INTEGER NOT NULL,
		idempotency_key TEXT NOT NULL,
		action TEXT NOT NULL,
		request_json TEXT NOT NULL DEFAULT '{}',
		result_json TEXT NOT NULL DEFAULT '{}',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, idempotency_key)
	);

CREATE TABLE IF NOT EXISTS user_feedback (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		category TEXT NOT NULL DEFAULT 'issue',
		content TEXT NOT NULL,
		context_json TEXT,
		status TEXT NOT NULL DEFAULT 'received',
		request_key TEXT,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME
	);

CREATE TABLE IF NOT EXISTS feedback_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		feedback_id INTEGER NOT NULL,
		author_id INTEGER NOT NULL,
		author_role TEXT NOT NULL,
		visibility TEXT NOT NULL DEFAULT 'public',
		content TEXT NOT NULL,
		status TEXT,
		request_key TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS voice_pack_versions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				voice_id TEXT NOT NULL,
				name TEXT NOT NULL,
				version TEXT NOT NULL,
				language TEXT NOT NULL DEFAULT 'zh-CN',
				style_tags_json TEXT NOT NULL DEFAULT '[]',
				manifest_json TEXT NOT NULL,
				resource_fingerprint TEXT NOT NULL UNIQUE,
				provider_voice TEXT,
				status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'disabled', 'revoked')),
				revision INTEGER NOT NULL DEFAULT 1,
				created_by INTEGER,
				reviewed_by INTEGER,
				published_at DATETIME,
				revoked_at DATETIME,
				revoke_reason TEXT,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(voice_id, version),
				FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
				FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
			);

CREATE TABLE IF NOT EXISTS voice_pack_status_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				voice_pack_version_id INTEGER NOT NULL,
				actor_user_id INTEGER,
				from_status TEXT,
				to_status TEXT NOT NULL,
				reason TEXT,
				revision INTEGER NOT NULL,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (voice_pack_version_id) REFERENCES voice_pack_versions(id) ON DELETE CASCADE,
				FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
			);

CREATE INDEX IF NOT EXISTS idx_voice_pack_versions_status_voice
				ON voice_pack_versions(status, voice_id, version);

CREATE INDEX IF NOT EXISTS idx_voice_pack_history_version_created
				ON voice_pack_status_history(voice_pack_version_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS user_voice_preferences (
				user_id INTEGER PRIMARY KEY,
				selected_voice_id TEXT,
				selected_version TEXT,
				preference TEXT NOT NULL DEFAULT 'automatic' CHECK(preference IN ('automatic', 'system-only')),
				version INTEGER NOT NULL DEFAULT 1,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);

CREATE TABLE IF NOT EXISTS sms_auth_challenges (
		id TEXT PRIMARY KEY,
		phone TEXT NOT NULL,
		purpose TEXT NOT NULL,
		code_hash TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		attempts INTEGER NOT NULL DEFAULT 0,
		user_id INTEGER,
		session_version INTEGER,
		target_phone TEXT,
		recovery_hash TEXT,
		recovery_expires_at TEXT,
		registration_token_hash TEXT,
		registration_expires_at TEXT,
		expires_at TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS sms_dev_outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		phone TEXT,
		purpose TEXT,
		code TEXT,
		challenge_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS account_reauth_grants (
		token_hash TEXT PRIMARY KEY,
		user_id INTEGER,
		purpose TEXT,
		phone TEXT,
		session_version INTEGER,
		expires_at TEXT,
		consumed_at TEXT
	);

CREATE TABLE IF NOT EXISTS email_auth_challenges (
		id TEXT PRIMARY KEY,
		user_id INTEGER,
		email TEXT NOT NULL,
		purpose TEXT NOT NULL,
		session_version INTEGER,
		code_hash TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		attempts INTEGER NOT NULL DEFAULT 0,
		recovery_hash TEXT,
		recovery_expires_at TEXT,
		expires_at TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS email_dev_outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT, purpose TEXT, code TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS onboarding_save_failures (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		payload_json TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS core_loop_metric_settings (
		id INTEGER PRIMARY KEY CHECK(id=1),
		environment TEXT,
		enabled INTEGER NOT NULL DEFAULT 0,
		coverage_start DATETIME,
		version INTEGER NOT NULL DEFAULT 1,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS core_loop_actor_classifications (
		user_id INTEGER PRIMARY KEY,
		kind TEXT NOT NULL DEFAULT 'unknown',
		version INTEGER NOT NULL DEFAULT 1,
		classified_by INTEGER,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE IF NOT EXISTS notification_campaigns (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			admin_user_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			body TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'draft',
			recipient_count INTEGER NOT NULL DEFAULT 0,
			success_count INTEGER NOT NULL DEFAULT 0,
			failure_count INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE IF NOT EXISTS community_event_participants (post_id INTEGER, user_id INTEGER, PRIMARY KEY(post_id,user_id));
