# Contributing to SSP Relay  

We’re excited that you’re considering contributing to SSP Relay! As the communication backbone of the SSP Wallet ecosystem, SSP Relay ensures secure, reliable interactions between SSP Wallet and SSP Key. Your contributions are essential in maintaining and improving this critical infrastructure.  

For technical details and guidelines, please refer to the [SSP Documentation](https://sspwallet.gitbook.io/docs).  

---

## Code of Conduct  

Please review and follow our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to foster a respectful and inclusive environment.  

---

## Ways to Contribute  

### 1. Report Bugs  
If you identify an issue:  
- [Create an issue](https://github.com/RunOnFlux/ssp-relay/issues) and include:  
  - Steps to reproduce the problem.  
  - Logs, error messages, or screenshots if applicable.  
  - Environment details (Node.js version, MongoDB version, OS).  

### 2. Suggest Features  
Have ideas to enhance SSP Relay? Open a feature request in the [issues section](https://github.com/RunOnFlux/ssp-relay/issues). Provide as much detail as possible, including use cases and the problem the feature addresses.  

### 3. Improve Documentation  
Help us enhance the documentation by contributing updates or creating new guides. For reference, see the [SSP Documentation](https://sspwallet.gitbook.io/docs).  

### 4. Submit Code Contributions  
Assist by fixing bugs, adding features, or improving performance. Contributions to enhance scalability, security, or usability are especially valuable.  

---

## Development Environment  

### Prerequisites  
- **Node.js**: Version 22 or higher  
- **MongoDB**: A running MongoDB instance  

### Setting Up  
1. **Fork the Repository**  
   ```bash  
   git clone https://github.com/runonflux/ssp-relay 
   cd ssp-relay  
   ```  

2. **Install Dependencies**  
   ```bash  
   yarn install  
   ```  

3. **Start the Development Server**  
   ```bash  
   yarn dev  
   ```  

Refer to the [SSP Documentation](https://sspwallet.gitbook.io/docs) for detailed setup and usage guidelines.  

---

## Coding Guidelines  

### Style Guide  
- Follow our **ESLint configuration** for consistent code style.  
- Format code using **Prettier**


### Type Checking  
Ensure TypeScript types are correct by running:  
```bash  
yarn type-check  
```  

### Testing  
- Write tests for new features or bug fixes.  
- Run tests locally to ensure reliability:  
   ```bash  
   yarn test  
   ```  

---

## Submitting a Pull Request  

Follow these steps to submit a PR:  

1. **Create a New Branch**  
   ```bash  
   git checkout -b feature/your-feature-name  
   ```  

2. **Make Changes**  
   - Focus on a specific issue or feature.  
   - Ensure all tests and linter checks pass before committing.  

3. **Commit Your Changes**  
   Use clear and descriptive commit messages:  
   ```bash  
   git commit -m "Add feature: your-feature-description"  
   ```  

4. **Push Your Branch**  
   ```bash  
   git push origin feature/your-feature-name  
   ```  

5. **Open a Pull Request**  
   - Submit your PR to the `main` branch of the SSP Relay repository.  
   - Provide a summary of your changes and link to any relevant issues.  

---

## Resources  

- **SSP Documentation**: [https://sspwallet.gitbook.io/docs](https://sspwallet.gitbook.io/docs)  
- **How to Contribute to Open Source**: [https://opensource.guide/how-to-contribute/](https://opensource.guide/how-to-contribute/)  
- **GitHub Help**: [https://help.github.com](https://help.github.com)  

---

## Need Help?  

If you have questions or need assistance:  
- Open an issue on GitHub.  
- Refer to the [SSP Documentation](https://sspwallet.gitbook.io/docs).  
- Join the community via [SSP Wallet Discord](https://discord.gg/runonflux).  

We’re excited to collaborate with you. Together, let’s make SSP Relay a secure and efficient bridge for the SSP ecosystem!  
