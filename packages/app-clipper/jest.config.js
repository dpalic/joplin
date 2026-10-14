module.exports = {
	testEnvironment: 'jsdom',
	testEnvironmentOptions: { url: 'https://www.youtube.com/watch?v=abc123' },
	testMatch: ['<rootDir>/tests/**/*.test.js'],
	collectCoverageFrom: ['content_scripts/youtubeTranscript.js'],
};
