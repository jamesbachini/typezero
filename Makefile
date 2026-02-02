.PHONY: test fmt lint dev dev-backend dev-frontend

test:
	cd contracts/leaderboard && cargo test
	cd risc0/typing_proof/host && cargo test
	cd risc0/typing_proof/methods/guest && cargo test
	cd frontend && npm test

fmt:
	cd contracts/leaderboard && cargo fmt
	cd risc0/typing_proof/host && cargo fmt
	cd risc0/typing_proof/methods/guest && cargo fmt

lint:
	cd contracts/leaderboard && cargo fmt -- --check
	cd risc0/typing_proof/host && cargo fmt -- --check
	cd risc0/typing_proof/methods/guest && cargo fmt -- --check
	cd frontend && npm run lint

dev:
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev
