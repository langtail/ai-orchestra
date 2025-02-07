# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2024-03-21

### Changed

- Modified `step-start` event formatting to only pass `messageId` instead of the entire chunk object

## [0.1.4] - 2025-02-07

### Added

- `onFinish` callback option to `createRun` for executing code when a run completes
- New unit tests for the `onFinish` callback functionality
- Documentation for the `onFinish` feature in README.md

### Changed

- Fixed type casting for `nextAgent` in state transitions

## [0.1.3] - Previous version

- Initial release with basic functionality
