/**
 * mysterious_code_generator.ts — A highly specific test tool.
 *
 * Encodes text using entirely custom non-obvious logic to test
 * whether the LLM correctly identified and called the exact tool API
 * rather than attempting to guess the answer natively.
 */

interface MysteriousCodeArgs {
    text: string;
}

function executeMysteriousCodeGenerator(args: MysteriousCodeArgs): { encodedText: string } {
    let result = '';
    const shift = 2; // Shift exactly 2 letters to the right
    
    // Split the text by spaces while keeping the actual space blocks intact
    const words = args.text.split(/(\s+)/);

    for (let w = 0; w < words.length; w++) {
        let word = words[w];
        
        // Skip pure whitespace blocks
        if (word.trim().length === 0) {
            result += word;
            continue;
        }

        let shiftedWord = '';
        let letterCount = 0;

        for (let i = 0; i < word.length; i++) {
            let char = word[i];
            
            // Check if character is a letter
            if (char.match(/[a-z]/i)) {
                letterCount++;

                // Determine ASCII base (Uppercase: 65, Lowercase: 97)
                const isUpper = char === char.toUpperCase();
                const asciiBase = isUpper ? 65 : 97;
                
                // Shift natively and wrap back around Z->A
                char = String.fromCharCode(((char.charCodeAt(0) - asciiBase + shift) % 26) + asciiBase);
            }
            
            shiftedWord += char;
        }
        
        // Append the exact count of letters immediately after the shifted word
        if (letterCount > 0) {
            result += shiftedWord + letterCount;
        } else {
            result += shiftedWord; // Handle pure punctuation or numbers gracefully
        }
    }

    return { encodedText: result };
}
