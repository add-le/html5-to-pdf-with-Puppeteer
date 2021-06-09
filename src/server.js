const express = require('express'), bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json({ limit: '50mb', extended: true }));

const { Cluster } = require('puppeteer-cluster');
const delay = require('delay');

const version = 'v1'

const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'API to convert html5 to image or pdf',
        version: '1.0.0',
    },
    servers: [
        {
            url: `http://localhost:3000/${version}`,
            description: 'Development server',
        },
    ],
};

const options = {
    swaggerDefinition,
    // Paths to files containing OpenAPI definitions
    apis: ['./src/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

(async () => {
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 10,
        puppeteerOptions: {
            headless: true,
            args: [
                // Required for Docker version of Puppeteer
                '--no-sandbox',
                '--disable-setuid-sandbox',
                // This will write shared memory files into /tmp instead of /dev/shm,
                // because Docker’s default for /dev/shm is 64MB
                '--disable-dev-shm-usage'
            ]
        },
    });

    cluster.on('taskerror', (err, data, willRetry) => {
        if (willRetry) {
          console.warn(`Encountered an error while crawling ${data}. ${err.message}\nThis job will be retried`);
        } else {
          console.error(`Failed to crawl ${data}: ${err.message}`);
        }
    });

    const generate = (params) => {

        const task = async ({ page, data }) => {

            await page.setDefaultNavigationTimeout(15000);
            await page.emulateTimezone('Europe/Paris')

            if (data.url) {
                await page.goto(data.url);
            }
            else if (data.html) {
                await page.setContent(data.html)
            } else {
                return { code: 400 }
            }

            if (data.waitFor) {
                await page.waitForSelector('#' + data.waitFor, { visible: true })
            }

            let buffer, contentType
            switch (data.format) {
                case 'pdf':
                    buffer = await page.pdf({
                        format: 'A4',
                        margin: { top: 30, right: 30, bottom: 60, left: 30 },
                        displayHeaderFooter: true,
                        headerTemplate: '<div></div>',
                        footerTemplate: `<div style="width: 100%; font-size: 9px;
                        padding: 5px 5px 0; color: black; position: relative;">
                        <div style="position: absolute; right: 50%; bottom: 15px;"><span class="pageNumber"></span>/<span class="totalPages"></span></div></div>`
                    });
                    contentType = 'application/pdf'
                    break;

                case 'image':
                    buffer = await page.screenshot();
                    contentType = 'image/jpg'
                    break;
            }

            let response = {
                code: 200,
                headers: {

                    'Content-Type': contentType,
                    'Content-Length': buffer.length

                },
                buffer: buffer
            }

            return response;
        };

        return cluster.execute(params, task);
    }

    /**
 * @swagger
 * /generate:
 *   get:
 *     summary: Retrieve a pdf or image of a page
 *     description: 
 *     parameters:
 *       - in: query
 *         name: format
 *         required: true
 *         description: image or pdf
 *         schema:
 *           type: string
 *       - in: query
 *         name: url
 *         required: true
 *         description: Url of the page
 *         schema:
 *           type: string
 *       - in: query
 *         name: waitFor
 *         required: false
 *         description: Wait for this id css
 *         schema:
 *           type: string
 */
    app.get(`/${version}/generate`, async function (req, res) {
        if (!req.query.url || !req.query.format) {
            return res.end('Please specify a format and a url like this: ?format=image&url=https://example.com');
        }
        try {
            let response = await generate(req.query)

            res.writeHead(response.code, response.headers);
            res.end(response.buffer);
        } catch (err) {
            res.end('Error: ' + err);
        }
    });

    /**
    * @swagger
    * /generate:
    *   post:
    *     summary: Retrieve a pdf or image file of a page
    *     description: 
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               format:
 *                 type: string
 *                 description: The user's name.
 *                 example: image
 *               html:
 *                 type: string
 *                 description: The user's name.
 *                 example: <!DOCTYPE html> <html> <body> <h1 id="myHeader">My First Heading</h1> <p>My first paragraph.</p></body> </html>
 *               waitFor:
 *                type: string
 *                description: Wait for this id css
 *                example: myHeader
 * 
    */
    app.post(`/${version}/generate`, async function (req, res) {

        try {

            let response = await generate(req.body)

            res.writeHead(response.code, response.headers);
            res.end(response.buffer);
        } catch (err) {
            res.end('Error: ' + err);
        }
    })

    app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

    app.listen(80, function () {
        console.log('HTML5 to image or pdf server listening on port 80.');
    });
})();