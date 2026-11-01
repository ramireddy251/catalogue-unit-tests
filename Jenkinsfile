
pipeline {

    agent {
        node {
            label 'Roboshop'
        }
    }

    environment {
        appVersion = ""

        AWS_ACCOUNT_ID = "104050870679"
        AWS_REGION     = "us-east-1"
        ECR_REPO_NAME  = "roboshop/catalogue"
        ECR_REGISTRY   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    }

    options {
        timeout(time: 2, unit: 'HOURS')
    }

    stages {

        stage('Read version') {
            steps {
                script {
                    def packageJson = readJSON file: 'package.json'

                    env.appVersion = packageJson.version

                    echo "Building version ${env.appVersion}"
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    npm install
                '''
            }
        }

        stage('Unit Tests') {
            steps {
                sh '''
                    npm test
                '''
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {
                    def scannerHome = tool name: 'sonar-8'

                    withSonarQubeEnv('sonar-server') {
                        sh """
                            ${scannerHome}/bin/sonar-scanner \
                              -Dsonar.exclusions=**/node_modules/**,**/coverage/**,**/trivy-report.html,**/trivy-os-report.html,**/trivy-reports/**,**/reports/**,**/*.html
                        """
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 1, unit: 'HOURS') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Dependabot Alerts Check') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'github-token',
                        variable: 'GITHUB_TOKEN'
                    )
                ]) {

                    script {

                        def owner = 'ramireddy251'
                        def repo  = 'catalogue-unit-tests'

                        def response = sh(
                            script: '''
                                curl -s -w "\\n%{http_code}" \
                                    -H "Authorization: Bearer $GITHUB_TOKEN" \
                                    -H "Accept: application/vnd.github+json" \
                                    -H "X-GitHub-Api-Version: 2022-11-28" \
                                    "https://api.github.com/repos/ramireddy251/catalogue-unit-tests/dependabot/alerts?severity=high,critical&state=open&per_page=100"
                            ''',
                            returnStdout: true
                        ).trim()

                        def parts = response.tokenize('\n')

                        def httpStatus = parts[-1].trim()
                        def body = parts[0..-2].join('\n')

                        if (httpStatus != '200') {
                            error """
                                GitHub API call failed with HTTP ${httpStatus}.
                                Check token permissions (security_events scope required).
                                Response: ${body}
                            """
                        }

                        def alerts = readJSON text: body

                        if (alerts.size() == 0) {

                            echo "No HIGH or CRITICAL Dependabot alerts found. Pipeline continues."

                        } else {

                            echo "Found ${alerts.size()} HIGH/CRITICAL Dependabot alert(s):"

                            alerts.each { alert ->

                                def pkg = alert.security_vulnerability?.package?.name ?: 'unknown'

                                def severity = alert.security_advisory?.severity?.toUpperCase() ?: 'UNKNOWN'

                                def summary = alert.security_advisory?.summary ?: 'No summary'

                                def fixedIn = alert.security_vulnerability?.first_patched_version?.identifier ?: 'No fix available'

                                echo """
                                    [${severity}] ${pkg} - ${summary}
                                    Fixed in: ${fixedIn}
                                """
                            }

                            error "Pipeline failed: ${alerts.size()} HIGH/CRITICAL Dependabot alert(s) detected."
                        }
                    }
                }
            }
        }

        stage('Build Image') {
            steps {
                script {

                    env.IMAGE_NAME = "${env.ECR_REGISTRY}/${env.ECR_REPO_NAME}:${env.appVersion}"

                    sh '''
                        docker build \
                            --no-cache \
                            -t "$IMAGE_NAME" .
                    '''
                }
            }
        }

        stage('Trivy OS Scan') {
            steps {
                script {

                    def imageName = env.IMAGE_NAME

                    // Download official Trivy HTML template
                    sh '''
                        curl -sfL \
                        https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/html.tpl \
                        -o html.tpl

                        test -s html.tpl
                    '''

                    // Generate text report
                    sh """
                        trivy image \
                            --scanners vuln \
                            --pkg-types os \
                            --severity HIGH,MEDIUM \
                            --format table \
                            --output trivy-os-report.txt \
                            --exit-code 0 \
                            ${imageName}
                    """

                    // Generate HTML report
                    sh """
                        trivy image \
                            --scanners vuln \
                            --pkg-types os \
                            --severity HIGH,MEDIUM \
                            --format template \
                            --template "@html.tpl" \
                            --output trivy-os-report.html \
                            --exit-code 0 \
                            ${imageName}
                    """

                    // Print scan results
                    sh 'cat trivy-os-report.txt'

                    // Publish HTML report in Jenkins
                    publishHTML(target: [
                        allowMissing          : false,
                        alwaysLinkToLastBuild : true,
                        keepAll               : true,
                        reportDir             : '.',
                        reportFiles           : 'trivy-os-report.html',
                        reportName            : 'Trivy OS Vulnerability Report'
                    ])

                    // Fail pipeline for HIGH and MEDIUM vulnerabilities
                    def scanResult = sh(
                        script: """
                            trivy image \
                                --scanners vuln \
                                --pkg-types os \
                                --severity HIGH,MEDIUM \
                                --format table \
                                --exit-code 1 \
                                --quiet \
                                ${imageName}
                        """,
                        returnStatus: true
                    )

                    if (scanResult != 0) {

                        error """
                            Trivy found HIGH/MEDIUM OS vulnerabilities.
                            Pipeline failed. Check Trivy OS Vulnerability Report.
                        """

                    } else {

                        echo "No HIGH or MEDIUM OS vulnerabilities found."
                    }
                }
            }
        }

        stage('Push to ECR') {
            steps {

                sh """
                    aws ecr get-login-password \
                        --region ${AWS_REGION} | \
                    docker login \
                        --username AWS \
                        --password-stdin ${ECR_REGISTRY}

                    docker push ${ECR_REGISTRY}/${ECR_REPO_NAME}:${appVersion}
                """
            }
        }
    }

    post {

        always {
            echo "Pipeline execution completed."
        }

        success {
            echo "Catalogue pipeline success."
        }

        failure {
            echo "Catalogue pipeline failure. Check the failed stage logs."
        }
    }
}
