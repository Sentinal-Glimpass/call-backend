  
    const fs = require('fs').promises; // fs.promises provides promise-based methods
    
    async function getSemanticScore( set1, set2){
        try {
            const data = await fs.readFile('glove.6B.50d.json', 'utf8');
            const embeddings = JSON.parse(data);
            const avgVector1 = await getAverageVector(set1, embeddings);
            const avgVector2 = await getAverageVector(set2, embeddings);
            const similarity = await cosineSimilarity(avgVector1, avgVector2);
            return similarity;
        } catch(error){
            console.error('Error loading or processing the embeddings:', error);
            throw error;
        }    
    }
    async function getAverageVector(words, embeddings) {
        const vectors = words.map(word => embeddings[word]).filter(vec => vec !== undefined);
        const numVectors = vectors.length;
        const sumVector = vectors.reduce((acc, vec) => acc.map((val, idx) => val + vec[idx]), new Array(50).fill(0));
        return sumVector.map(val => val / numVectors);
    }

    async function cosineSimilarity(vecA, vecB) {
        const dotProduct = vecA.reduce((sum, val, idx) => sum + val * vecB[idx], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }

    module.exports = { getSemanticScore }