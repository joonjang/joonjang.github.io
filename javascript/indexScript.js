let quotes = [];
let currentQuote = {};
let previousQuote = {};
let quoteInterval;

function fetchQuotes() {
    return fetch('quotes.json')
        .then(response => response.json())
        .then(data => {
            quotes = data;
            updateQuote();
        })
        .catch(error => console.error('Error loading quotes:', error));
}

function getRandomQuote() {
    if (quotes.length === 0) {
        return null;
    }
    return quotes[Math.floor(Math.random() * quotes.length)];
}

function displayQuote(quote) {
    if (!quote) return;

    const quoteTextElement = document.getElementById('quote');
    // Remove the show class to fade out the current quote text
    quoteTextElement.classList.remove('show');

    // After a short delay, update the quote text and fade in the new quote text
    setTimeout(() => {
        quoteTextElement.textContent = `"${quote.quote}" - ${quote.author}`;
        previousQuote = currentQuote;
        currentQuote = quote;

        // Add the show class to fade in the new quote text
        quoteTextElement.classList.add('show');
    }, 500); // This delay should match the CSS opacity transition time
}



function updateQuote() {
    const quote = getRandomQuote();
    if (quote) {
        displayQuote(quote);
    }
}

document.getElementById('new-quote').addEventListener('click', function() {
    clearInterval(quoteInterval);
    updateQuote();
    startAutoUpdate();
});

document.getElementById('prev-quote').addEventListener('click', function() {
    if (previousQuote.quote) {
        displayQuote(previousQuote);
        clearInterval(quoteInterval);
        startAutoUpdate();
    }
});

function startAutoUpdate() {
    quoteInterval = setInterval(updateQuote, 10000);
}

// Combine the window.onload functions
window.onload = function() {
    fetchQuotes().then(() => {
        updateQuote();
        startAutoUpdate();
    });
    document.getElementById('quote').classList.add('show');
};
