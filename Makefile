.PHONY: test fmt lint dev dev-backend dev-frontend dev-contracts deps deps-backend deps-frontend

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

deps: deps-backend deps-frontend

deps-backend:
	@test -d backend/node_modules || (cd backend && npm ci)

deps-frontend:
	@test -d frontend/node_modules || (cd frontend && npm ci)

dev: deps dev-contracts
	$(MAKE) -j2 dev-backend dev-frontend

dev-contracts: deps-backend
	node scripts/deploy-testnet.mjs

dev-backend: deps-backend
	cd backend && npm run dev

dev-frontend: deps-frontend
	cd frontend && npm run dev
